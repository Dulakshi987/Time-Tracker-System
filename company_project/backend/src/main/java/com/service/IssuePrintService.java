package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

@Service
public class IssuePrintService {

    @Autowired
    private IssueRepository issueRepository;

    // ── Existing (unpaginated) reads — kept for backward compatibility ──
    public List<Issue> getAllDocuments() {
        return issueRepository.findAll();
    }

    public Issue getById(Long id) {
        return issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Document not found with id: " + id));
    }

    public List<Issue> getByJobType(String jobType) {
        return issueRepository.findByJobType(jobType);
    }

    public List<Issue> getByPrintStatus(String printStatus) {
        return issueRepository.findByPrintStatus(printStatus);
    }

    // ── Paginated + filtered read (use this from the frontend) ──────────
    public Page<Issue> getDocumentsPaged(int page, int size, String jobType, String printStatus,
                                          String search, String date, List<String> divisionNos) {
        Pageable pageable = PageRequest.of(Math.max(page, 0), Math.max(size, 1), Sort.by(Sort.Direction.DESC, "id"));
        Specification<Issue> spec = buildSpec(jobType, printStatus, search, date, divisionNos);
        return issueRepository.findAll(spec, pageable);
    }

    // ── Stats — counts computed in the database, not by loading rows ───
    public Map<String, Long> getStats(String date, List<String> divisionNos) {
        Specification<Issue> base = buildSpec(null, null, null, date, divisionNos);

        long total = issueRepository.count(base);
        long onHold = issueRepository.count(withStatus(base, "ON_HOLD"));
        long inProgress = issueRepository.count(withStatus(base, "IN_PROGRESS"));
        long completed = issueRepository.count(withStatus(base, "COMPLETED"));
        long pending = Math.max(total - onHold - inProgress - completed, 0);

        return Map.of(
                "total", total,
                "pending", pending,
                "inProgress", inProgress,
                "onHold", onHold,
                "completed", completed
        );
    }

    private Specification<Issue> withStatus(Specification<Issue> base, String status) {
        return base.and((root, q, cb) -> cb.equal(root.get("printStatus"), status));
    }

    private Specification<Issue> buildSpec(String jobType, String printStatus, String search,
                                            String date, List<String> divisionNos) {
        Specification<Issue> spec = Specification.where(null);

        if (jobType != null && !jobType.isBlank() && !"ALL".equalsIgnoreCase(jobType)) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("jobType"), jobType));
        }

        if (printStatus != null && !printStatus.isBlank() && !"ALL".equalsIgnoreCase(printStatus)) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("printStatus"), printStatus));
        }

        if (search != null && !search.isBlank()) {
            String like = "%" + search.toLowerCase() + "%";
            spec = spec.and((root, q, cb) -> cb.or(
                    cb.like(cb.lower(root.get("jobwbs")), like),
                    cb.like(cb.lower(root.get("reservationNo")), like),
                    cb.like(cb.lower(root.get("requestedBy")), like),
                    cb.like(cb.lower(root.get("vehicleNo")), like)
            ));
        }

        // requestDate is stored as a plain String (e.g. "2026-08-12"), not a
        // LocalDate column — compare it as a String, matching how the
        // frontend already builds its date keys. Parsing this into a
        // LocalDate and comparing against a String column is exactly what
        // was causing the 500 (Hibernate parameter type mismatch).
        if (date != null && !date.isBlank()) {
            String trimmed = date.trim();
            spec = spec.and((root, q, cb) -> cb.equal(root.get("requestDate"), trimmed));
        }

        if (divisionNos != null && !divisionNos.isEmpty()) {
            spec = spec.and((root, q, cb) -> root.get("divisionNo").in(divisionNos));
        }

        return spec;
    }

    // Convenience overload for a comma-separated divisions string coming straight off a query param
    public Page<Issue> getDocumentsPaged(int page, int size, String jobType, String printStatus,
                                          String search, String date, String divisionsCsv) {
        return getDocumentsPaged(page, size, jobType, printStatus, search, date, toList(divisionsCsv));
    }

    public Map<String, Long> getStats(String date, String divisionsCsv) {
        return getStats(date, toList(divisionsCsv));
    }

    private List<String> toList(String csv) {
        if (csv == null || csv.isBlank()) return null;
        return Arrays.asList(csv.split(","));
    }

    // ── Step 1: Handover ── PENDING -> HANDED_OVER ──────────────────────
    // Records who handed the document over. Work has not started yet.
    public Issue handoverPrint(Long id, String handedOverBy) {
        Issue doc = getById(id);
        doc.setPrintHandedOverBy(handedOverBy);
        doc.setPrintHandoverTime(LocalDateTime.now());
        doc.setPrintStatus("HANDED_OVER");
        doc.setPrintTotalHoldSeconds(0L);
        return issueRepository.save(doc);
    }

    // ── Step 2: Start / Resume ── HANDED_OVER -> IN_PROGRESS, ───────────
    // ── or ON_HOLD -> IN_PROGRESS (resume) ───────────────────────────────
    public Issue startPrint(Long id) {
        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getPrintStatus())) {
            // Resume from hold
            LocalDateTime now = LocalDateTime.now();
            doc.setPrintResumeTime(now);
            if (doc.getPrintHoldTime() != null) {
                long holdSec = Duration.between(doc.getPrintHoldTime(), now).getSeconds();
                long existing = doc.getPrintTotalHoldSeconds() != null ? doc.getPrintTotalHoldSeconds() : 0L;
                doc.setPrintTotalHoldSeconds(existing + holdSec);
            }
        } else {
            // First start, right after handover
            doc.setPrintStartTime(LocalDateTime.now());
            if (doc.getPrintTotalHoldSeconds() == null) {
                doc.setPrintTotalHoldSeconds(0L);
            }
        }

        doc.setPrintStatus("IN_PROGRESS");
        return issueRepository.save(doc);
    }

    // ── Hold ── IN_PROGRESS -> ON_HOLD ───────────────────────────────────
    public Issue holdPrint(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);
        doc.setPrintStatus("ON_HOLD");
        doc.setPrintHoldTime(LocalDateTime.now());
        doc.setPrintHoldReason(holdReason);
        doc.setPrintHeldBy(heldBy);
        return issueRepository.save(doc);
    }

    // ── End ── IN_PROGRESS / ON_HOLD -> COMPLETED ────────────────────────
    public Issue endPrint(Long id, String printDocumentNo, String printedBy) {
        Issue doc = getById(id);
        LocalDateTime endTime = LocalDateTime.now();
        doc.setPrintStatus("COMPLETED");
        doc.setPrintEndTime(endTime);
        doc.setPrintDocumentNo(printDocumentNo);
        doc.setPrintedBy(printedBy);

        if (doc.getPrintStartTime() != null) {
            long total    = Duration.between(doc.getPrintStartTime(), endTime).getSeconds();
            long holdTime = doc.getPrintTotalHoldSeconds() != null ? doc.getPrintTotalHoldSeconds() : 0L;
            doc.setPrintDurationSeconds(Math.max(total - holdTime, 0));
        }

        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
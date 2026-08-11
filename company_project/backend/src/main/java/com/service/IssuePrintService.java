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
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class IssuePrintService {

    @Autowired
    private IssueRepository issueRepository;

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

    // ── Paginated + filtered list ────────────────────────────────────────
    public Page<Issue> getPaginated(int page, int size, String status, String jobType,
                                     String search, LocalDate fromDate, LocalDate toDate) {

        Specification<Issue> spec = buildSpec(status, jobType, search, fromDate, toDate);

        int safeSize = Math.min(Math.max(size, 1), 100); // hard cap so nobody can request size=100000
        Pageable pageable = PageRequest.of(Math.max(page, 0), safeSize, Sort.by(Sort.Direction.DESC, "id"));
        return issueRepository.findAll(spec, pageable);
    }

    // ── Stat chip counts — DB COUNT queries, doesn't load rows ───────────
    public Map<String, Long> getStats(LocalDate fromDate, LocalDate toDate) {
        Map<String, Long> stats = new LinkedHashMap<>();
        stats.put("total", countBy(null, fromDate, toDate));
        stats.put("pending", countByPending(fromDate, toDate));
        stats.put("inprogress", countBy("IN_PROGRESS", fromDate, toDate));
        stats.put("onhold", countBy("ON_HOLD", fromDate, toDate));
        stats.put("completed", countBy("COMPLETED", fromDate, toDate));
        return stats;
    }

    private Specification<Issue> buildSpec(String status, String jobType, String search,
                                            LocalDate fromDate, LocalDate toDate) {
        Specification<Issue> spec = Specification.where(null);

        if (status != null && !status.isBlank() && !status.equalsIgnoreCase("ALL")) {
            if (status.equalsIgnoreCase("PENDING")) {
                // Pending = no status set yet (before handover) OR explicitly PENDING.
                // Adjust this if your entity always defaults printStatus to "PENDING".
                spec = spec.and((root, q, cb) -> cb.or(
                        cb.isNull(root.get("printStatus")),
                        cb.equal(root.get("printStatus"), "PENDING")
                ));
            } else {
                String s = status;
                spec = spec.and((root, q, cb) -> cb.equal(root.get("printStatus"), s));
            }
        }
        if (jobType != null && !jobType.isBlank() && !jobType.equalsIgnoreCase("ALL")) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("jobType"), jobType));
        }
        if (fromDate != null) {
            spec = spec.and((root, q, cb) -> cb.greaterThanOrEqualTo(root.get("requestDate"), fromDate));
        }
        if (toDate != null) {
            spec = spec.and((root, q, cb) -> cb.lessThanOrEqualTo(root.get("requestDate"), toDate));
        }
        if (search != null && !search.isBlank()) {
            String like = "%" + search.trim().toLowerCase() + "%";
            spec = spec.and((root, q, cb) -> cb.or(
                    cb.like(cb.lower(root.get("jobwbs")), like),
                    cb.like(cb.lower(root.get("reservationNo")), like),
                    cb.like(cb.lower(root.get("requestedBy")), like),
                    cb.like(cb.lower(root.get("vehicleNo")), like),
                    cb.like(cb.lower(root.get("jobType")), like)
            ));
        }
        return spec;
    }

    private long countBy(String status, LocalDate fromDate, LocalDate toDate) {
        Specification<Issue> spec = Specification.where(null);
        if (status != null) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("printStatus"), status));
        }
        if (fromDate != null) {
            spec = spec.and((root, q, cb) -> cb.greaterThanOrEqualTo(root.get("requestDate"), fromDate));
        }
        if (toDate != null) {
            spec = spec.and((root, q, cb) -> cb.lessThanOrEqualTo(root.get("requestDate"), toDate));
        }
        return issueRepository.count(spec);
    }

    private long countByPending(LocalDate fromDate, LocalDate toDate) {
        Specification<Issue> spec = Specification.where(
                (root, q, cb) -> cb.or(
                        cb.isNull(root.get("printStatus")),
                        cb.equal(root.get("printStatus"), "PENDING")
                )
        );
        if (fromDate != null) {
            spec = spec.and((root, q, cb) -> cb.greaterThanOrEqualTo(root.get("requestDate"), fromDate));
        }
        if (toDate != null) {
            spec = spec.and((root, q, cb) -> cb.lessThanOrEqualTo(root.get("requestDate"), toDate));
        }
        return issueRepository.count(spec);
    }

    // ── Step 1: Handover ── PENDING -> HANDED_OVER ──────────────────────
    public Issue handoverPrint(Long id, String handedOverBy) {
        Issue doc = getById(id);
        doc.setPrintHandedOverBy(handedOverBy);
        doc.setPrintHandoverTime(LocalDateTime.now());
        doc.setPrintStatus("HANDED_OVER");
        doc.setPrintTotalHoldSeconds(0L);
        return issueRepository.save(doc);
    }

    // ── Step 2: Start / Resume ───────────────────────────────────────────
    public Issue startPrint(Long id) {
        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getPrintStatus())) {
            LocalDateTime now = LocalDateTime.now();
            doc.setPrintResumeTime(now);
            if (doc.getPrintHoldTime() != null) {
                long holdSec = Duration.between(doc.getPrintHoldTime(), now).getSeconds();
                long existing = doc.getPrintTotalHoldSeconds() != null ? doc.getPrintTotalHoldSeconds() : 0L;
                doc.setPrintTotalHoldSeconds(existing + holdSec);
            }
        } else {
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
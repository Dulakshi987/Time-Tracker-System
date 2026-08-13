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
public class IssuePickService {

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
    public List<String> getAllJobTypes(List<String> divisionNos) {
    if (divisionNos != null && !divisionNos.isEmpty()) {
        return issueRepository.findDistinctJobTypesByDivisions(divisionNos);
    }

    return issueRepository.findDistinctJobTypes();
}
    public List<Issue> getByStatus(String status) {
        return issueRepository.findByStatus(status);
    }

    // ── Paginated + filtered read — this is what the Pick Portal frontend
    // grid should call. Same pattern as IssuePrintService.getDocumentsPaged. ──
    public Page<Issue> getDocumentsPaged(int page, int size, String jobType, String status,
                                          String search, String date, List<String> divisionNos) {
        Pageable pageable = PageRequest.of(Math.max(page, 0), Math.max(size, 1), Sort.by(Sort.Direction.DESC, "id"));
        Specification<Issue> spec = buildSpec(jobType, status, search, date, divisionNos);
        return issueRepository.findAll(spec, pageable);
    }

    // ── Stats — counts computed in the database, not by loading rows ───
    public Map<String, Long> getStats(String date, List<String> divisionNos) {
        Specification<Issue> base = buildSpec(null, null, null, date, divisionNos);

        long total = issueRepository.count(base);
        long handedOver = issueRepository.count(withStatus(base, "HANDED_OVER"));
        long inProgress = issueRepository.count(withStatus(base, "IN_PROGRESS"));
        long onHold = issueRepository.count(withStatus(base, "ON_HOLD"));
        long completed = issueRepository.count(withStatus(base, "COMPLETED"));
        // "Pending" is never actually stored as a literal status — a fresh
        // document just has status = null/blank until Handover happens.
        // So pending = whatever's left over, same trick used in Print.
        long pending = Math.max(total - handedOver - inProgress - onHold - completed, 0);

        return Map.of(
                "total", total,
                "pending", pending,
                "handedOver", handedOver,
                "inProgress", inProgress,
                "onHold", onHold,
                "completed", completed
        );
    }

    private Specification<Issue> withStatus(Specification<Issue> base, String status) {
        return base.and((root, q, cb) -> cb.equal(root.get("status"), status));
    }

    private Specification<Issue> buildSpec(String jobType, String status, String search,
                                            String date, List<String> divisionNos) {
        Specification<Issue> spec = Specification.where(null);

        if (jobType != null && !jobType.isBlank() && !"ALL".equalsIgnoreCase(jobType)) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("jobType"), jobType));
        }

        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            if ("PENDING".equalsIgnoreCase(status)) {
                // Pending documents have no status set yet — match null/blank
                // instead of a literal "PENDING" string that's never written.
                spec = spec.and((root, q, cb) -> cb.or(
                        cb.isNull(root.get("status")),
                        cb.equal(root.get("status"), "")
                ));
            } else {
                spec = spec.and((root, q, cb) -> cb.equal(root.get("status"), status));
            }
        }

        if (search != null && !search.isBlank()) {
            String like = "%" + search.toLowerCase() + "%";
            spec = spec.and((root, q, cb) -> cb.or(
                    cb.like(cb.lower(root.get("jobwbs")), like),
                    cb.like(cb.lower(root.get("reservationNo")), like),
                    cb.like(cb.lower(root.get("enteredBy")), like),
                    cb.like(cb.lower(root.get("jobType")), like)
            ));
        }

        // requestDate is a plain String column (e.g. "2026-08-12") — compare
        // as String, same as Print, to avoid a Hibernate type-mismatch 500.
        if (date != null && !date.isBlank()) {
            String trimmed = date.trim();
            spec = spec.and((root, q, cb) -> cb.equal(root.get("requestDate"), trimmed));
        }

        if (divisionNos != null && !divisionNos.isEmpty()) {
            spec = spec.and((root, q, cb) -> root.get("divisionNo").in(divisionNos));
        }

        // Pick Portal only ever shows documents that already came through
        // Print — this replaces the old client-side
        // `data.filter(d => d.printDocumentNo && ...)` from IssuePick.js.
        spec = spec.and((root, q, cb) -> cb.and(
                cb.isNotNull(root.get("printDocumentNo")),
                cb.notEqual(root.get("printDocumentNo"), "")
        ));

        return spec;
    }

    // Convenience overloads for a comma-separated divisions string coming
    // straight off a query param.
    public Page<Issue> getDocumentsPaged(int page, int size, String jobType, String status,
                                          String search, String date, String divisionsCsv) {
        return getDocumentsPaged(page, size, jobType, status, search, date, toList(divisionsCsv));
    }

    public Map<String, Long> getStats(String date, String divisionsCsv) {
        return getStats(date, toList(divisionsCsv));
    }

    private List<String> toList(String csv) {
        if (csv == null || csv.isBlank()) return null;
        return Arrays.asList(csv.split(","));
    }

    // ── Existing action methods — unchanged ──────────────────────────────
    public Issue startPrint(Long id) {
        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getStatus())) {
            LocalDateTime now = LocalDateTime.now();
            doc.setResumeTime(now);

            if (doc.getHoldTime() != null) {
                long holdSeconds = Duration.between(doc.getHoldTime(), now).getSeconds();
                long existing = doc.getTotalHoldSeconds() != null ? doc.getTotalHoldSeconds() : 0L;
                doc.setTotalHoldSeconds(existing + holdSeconds);
            }
        } else {
            doc.setStartTime(LocalDateTime.now());
            doc.setTotalHoldSeconds(0L);
        }

        doc.setStatus("IN_PROGRESS");
        return issueRepository.save(doc);
    }

    public Issue holdPrint(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);

        doc.setStatus("ON_HOLD");
        doc.setHoldTime(LocalDateTime.now());
        doc.setHoldReason(holdReason);
        doc.setHeldBy(heldBy);

        return issueRepository.save(doc);
    }

    public Issue endPrint(Long id, String pickedBy) {
        Issue doc = getById(id);

        LocalDateTime endTime = LocalDateTime.now();
        doc.setStatus("COMPLETED");
        doc.setEndTime(endTime);
        doc.setPickedBy(pickedBy);

        if (doc.getStartTime() != null) {
            long totalElapsed = Duration.between(doc.getStartTime(), endTime).getSeconds();
            long holdTime     = doc.getTotalHoldSeconds() != null ? doc.getTotalHoldSeconds() : 0L;
            long workingTime  = totalElapsed - holdTime;
            doc.setDurationSeconds(Math.max(workingTime, 0));
        }

        return issueRepository.save(doc);
    }

    public Issue emergencyResolve(Long id, String resolvedBy) {
        Issue doc = getById(id);

        doc.setEmergencyPickResolved(true);
        doc.setEmergencyPickResolvedBy(resolvedBy);
        doc.setEmergencyResolvedTime(LocalDateTime.now());

        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }

    public Issue handoverPrint(Long id, String handedOverBy) {
        Issue doc = getById(id);

        doc.setStatus("HANDED_OVER");
        doc.setPrintHandedOverBy(handedOverBy);
        // doc.setHandoverTime(LocalDateTime.now());

        return issueRepository.save(doc);
    }
}
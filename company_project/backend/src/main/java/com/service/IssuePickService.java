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
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class IssuePickService {

    @Autowired
    private IssueRepository issueRepository;

    // ── Legacy (existing) methods — unchanged, other callers depend on these ──

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

    public List<Issue> getByStatus(String status) {
        return issueRepository.findByStatus(status);
    }

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

    // ── Emergency Pick Done (resolves a wrong-material flag raised by Check) ──
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

    // ── New: paginated + filtered fetch, same pattern as IssuePrintController ──

    public Page<Issue> getDocumentsPaged(
            int page, int size, String jobType, String status, String search,
            String date, String divisions) {

        Specification<Issue> spec = baseSpec(date, divisions)
                .and(jobTypeSpec(jobType))
                .and(statusSpec(status))
                .and(searchSpec(search));

        Pageable pageable = PageRequest.of(Math.max(page, 0), size <= 0 ? 25 : size,
                Sort.by(Sort.Direction.DESC, "id"));

        return issueRepository.findAll(spec, pageable);
    }

    // ── Stat chip counts — computed in the DB, independent of page size ──

    public Map<String, Long> getStats(String date, String divisions) {
        Specification<Issue> base = baseSpec(date, divisions);

        Map<String, Long> stats = new LinkedHashMap<>();
        stats.put("total", issueRepository.count(base));
        stats.put("pending", issueRepository.count(base.and(statusSpec("pending"))));
        stats.put("handedOver", issueRepository.count(base.and(statusSpec("handedover"))));
        stats.put("inProgress", issueRepository.count(base.and(statusSpec("inprogress"))));
        stats.put("onHold", issueRepository.count(base.and(statusSpec("onhold"))));
        stats.put("completed", issueRepository.count(base.and(statusSpec("completed"))));
        return stats;
    }

    // ── Specification builders (private, kept inside this class — no extra files) ──

    // Documents that have reached Pick (printDocumentNo set) + optional date/division scope.
    // Always applied as the base filter, same role as Print portal's "always visible" scope.
    private Specification<Issue> baseSpec(String date, String divisions) {
        Specification<Issue> spec = (root, query, cb) -> cb.and(
                cb.isNotNull(root.get("printDocumentNo")),
                cb.notEqual(cb.trim(root.get("printDocumentNo")), "")
        );

        if (date != null && !date.isBlank()) {
            LocalDate d = LocalDate.parse(date);
            spec = spec.and((root, query, cb) -> cb.equal(root.get("requestDate"), d));
        }

        if (divisions != null && !divisions.isBlank()) {
            List<String> divList = Arrays.stream(divisions.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .toList();
            if (!divList.isEmpty()) {
                spec = spec.and((root, query, cb) -> root.get("divisionNo").in(divList));
            }
        }

        return spec;
    }

    private Specification<Issue> jobTypeSpec(String jobType) {
        if (jobType == null || jobType.isBlank() || jobType.equalsIgnoreCase("ALL")) return null;
        return (root, query, cb) -> cb.equal(root.get("jobType"), jobType);
    }

    private Specification<Issue> searchSpec(String search) {
        if (search == null || search.isBlank()) return null;
        String like = "%" + search.toLowerCase() + "%";
        return (root, query, cb) -> cb.or(
                cb.like(cb.lower(root.get("jobwbs")), like),
                cb.like(cb.lower(root.get("reservationNo")), like),
                cb.like(cb.lower(root.get("enteredBy")), like),
                cb.like(cb.lower(root.get("jobType")), like),
                cb.like(root.get("id").as(String.class), like)
        );
    }

    // statusClass = "pending" | "handedover" | "inprogress" | "onhold" | "completed"
    private Specification<Issue> statusSpec(String statusClass) {
        if (statusClass == null || statusClass.isBlank() || statusClass.equalsIgnoreCase("ALL")) return null;
        String raw = switch (statusClass.toLowerCase()) {
            case "pending" -> "PENDING";
            case "handedover" -> "HANDED_OVER";
            case "inprogress" -> "IN_PROGRESS";
            case "onhold" -> "ON_HOLD";
            case "completed" -> "COMPLETED";
            default -> null;
        };
        if (raw == null) return null;
        return (root, query, cb) -> cb.equal(root.get("status"), raw);
    }
}
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
public class CheckPortalService {

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

    public List<Issue> getByCheckStatus(String status) {
        return issueRepository.findByCheckStatus(status);
    }

    // ── Paginated + filtered read — this is what the Check Portal frontend
    // grid should call. Same pattern as IssuePrintService / IssuePickService. ──
    public Page<Issue> getDocumentsPaged(int page, int size, String jobType, String status,
                                          String search, String date, List<String> divisionNos) {
        Pageable pageable = PageRequest.of(Math.max(page, 0), Math.max(size, 1), Sort.by(Sort.Direction.DESC, "id"));
        Specification<Issue> spec = buildSpec(jobType, status, search, date, divisionNos);
        return issueRepository.findAll(spec, pageable);
    }

    // ── Stats — counts computed in the database, not by loading rows ───
    // "Pending" mirrors the frontend's isPendingOrUnresolvedError rule: a
    // document counts as Pending if checkStatus is blank (never started),
    // OR it's flagged with an unresolved picking error and not yet
    // Check-Done — even if its raw checkStatus happens to be ON_HOLD.
    public Map<String, Long> getStats(String date, List<String> divisionNos) {
        Specification<Issue> base = buildSpec(null, null, null, date, divisionNos);

        long total = issueRepository.count(base);
        long inProgress = issueRepository.count(withCheckStatus(base, "IN_PROGRESS"));
        long onHold = issueRepository.count(withCheckStatus(base, "ON_HOLD"));
        long completed = issueRepository.count(withCheckStatus(base, "COMPLETED"));
        long wrongMaterial = issueRepository.count(
                base.and((root, q, cb) -> cb.equal(cb.upper(root.get("hasWrongMaterial")), "YES"))
        );

        Specification<Issue> pendingSpec = base.and((root, q, cb) -> cb.or(
                cb.isNull(root.get("checkStatus")),
                cb.equal(root.get("checkStatus"), ""),
                cb.and(
                        cb.equal(cb.upper(root.get("hasWrongMaterial")), "YES"),
                        cb.equal(root.get("emergencyPickResolved"), false),
                        cb.notEqual(root.get("checkStatus"), "COMPLETED")
                )
        ));
        long pending = issueRepository.count(pendingSpec);

        return Map.of(
                "total", total,
                "pending", pending,
                "inProgress", inProgress,
                "onHold", onHold,
                "completed", completed,
                "wrongMaterial", wrongMaterial
        );
    }

    private Specification<Issue> withCheckStatus(Specification<Issue> base, String status) {
        return base.and((root, q, cb) -> cb.equal(root.get("checkStatus"), status));
    }

    private Specification<Issue> buildSpec(String jobType, String status, String search,
                                            String date, List<String> divisionNos) {
        Specification<Issue> spec = Specification.where(null);

        if (jobType != null && !jobType.isBlank() && !"ALL".equalsIgnoreCase(jobType)) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("jobType"), jobType));
        }

        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            if ("PENDING".equalsIgnoreCase(status)) {
                // Pending = blank checkStatus OR an unresolved picking error
                // that hasn't reached Check-Done yet — same rule as the stat.
                spec = spec.and((root, q, cb) -> cb.or(
                        cb.isNull(root.get("checkStatus")),
                        cb.equal(root.get("checkStatus"), ""),
                        cb.and(
                                cb.equal(cb.upper(root.get("hasWrongMaterial")), "YES"),
                                cb.equal(root.get("emergencyPickResolved"), false),
                                cb.notEqual(root.get("checkStatus"), "COMPLETED")
                        )
                ));
            } else {
                spec = spec.and((root, q, cb) -> cb.equal(root.get("checkStatus"), status));
            }
        }

        if (search != null && !search.isBlank()) {
            String like = "%" + search.toLowerCase() + "%";
            spec = spec.and((root, q, cb) -> cb.or(
                    cb.like(cb.lower(root.get("jobwbs")), like),
                    cb.like(cb.lower(root.get("reservationNo")), like),
                    cb.like(cb.lower(root.get("requestedBy")), like),
                    cb.like(cb.lower(root.get("enteredBy")), like),
                    cb.like(cb.lower(root.get("jobType")), like)
            ));
        }

        // requestDate is a plain String column (e.g. "2026-08-12") — compare
        // as String, same as Print/Pick, to avoid a Hibernate type-mismatch 500.
        if (date != null && !date.isBlank()) {
            String trimmed = date.trim();
            spec = spec.and((root, q, cb) -> cb.equal(root.get("requestDate"), trimmed));
        }

        if (divisionNos != null && !divisionNos.isEmpty()) {
            spec = spec.and((root, q, cb) -> root.get("divisionNo").in(divisionNos));
        }

        // Check Portal only ever shows documents that are Pick-Done AND
        // already have a Print document number — this replaces the old
        // client-side `data.filter(d => pickDone && hasDocNo)` from
        // IssueCheck.jsx's fetchDocuments.
        spec = spec.and((root, q, cb) -> cb.and(
                cb.equal(root.get("status"), "COMPLETED"),
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
    public Issue startCheck(Long id) {
        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getCheckStatus())) {
            LocalDateTime now = LocalDateTime.now();
            doc.setCheckResumeTime(now);

            if (doc.getCheckHoldTime() != null) {
                long holdSeconds = Duration.between(doc.getCheckHoldTime(), now).getSeconds();
                long existing = doc.getCheckTotalHoldSeconds() != null ? doc.getCheckTotalHoldSeconds() : 0L;
                doc.setCheckTotalHoldSeconds(existing + holdSeconds);
            }
        } else {
            doc.setCheckStartTime(LocalDateTime.now());
            doc.setCheckTotalHoldSeconds(0L);
        }

        doc.setCheckStatus("IN_PROGRESS");
        return issueRepository.save(doc);
    }

    public Issue holdCheck(Long id, String holdReason, String heldBy,
                            String hasWrongMaterial, String wrongMaterialSku, String wrongMaterialQty) {
        Issue doc = getById(id);

        doc.setCheckStatus("ON_HOLD");
        doc.setCheckHoldTime(LocalDateTime.now());
        doc.setCheckHoldReason(holdReason);
        doc.setCheckHeldBy(heldBy);

        if (hasWrongMaterial != null) {
            doc.setHasWrongMaterial(hasWrongMaterial);
            if ("YES".equalsIgnoreCase(hasWrongMaterial)) {
                doc.setWrongMaterialSku(wrongMaterialSku);
                doc.setWrongMaterialQty(wrongMaterialQty);
                doc.setEmergencyPickResolved(false);
                doc.setEmergencyPickResolvedBy(null);
                doc.setEmergencyResolvedTime(null);
            }
        }

        return issueRepository.save(doc);
    }

    public Issue endCheck(Long id, String checkedBy) {
        Issue doc = getById(id);

        LocalDateTime endTime = LocalDateTime.now();
        doc.setCheckStatus("COMPLETED");
        doc.setCheckEndTime(endTime);
        doc.setCheckedBy(checkedBy);

        if (doc.getCheckStartTime() != null) {
            long totalElapsed = Duration.between(doc.getCheckStartTime(), endTime).getSeconds();
            long holdTime     = doc.getCheckTotalHoldSeconds() != null ? doc.getCheckTotalHoldSeconds() : 0L;
            doc.setCheckDurationSeconds(Math.max(totalElapsed - holdTime, 0));
        }

        if (doc.getDeliveryStatus() == null || doc.getDeliveryStatus().isEmpty()) {
            doc.setDeliveryStatus("PENDING");
            doc.setDeliveryStartTime(endTime);
        }

        return issueRepository.save(doc);
    }

    public Issue editCheck(Long id, String heldBy, String checkedBy) {
        Issue doc = getById(id);

        if (heldBy != null && !heldBy.isBlank()) {
            doc.setCheckHeldBy(heldBy);
        }
        if (checkedBy != null && !checkedBy.isBlank()) {
            doc.setCheckedBy(checkedBy);
        }

        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
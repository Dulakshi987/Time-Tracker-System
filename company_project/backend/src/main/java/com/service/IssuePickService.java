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

    // ─────────────────────────────────────────────────────────────────────
    // Existing unpaginated reads
    // ─────────────────────────────────────────────────────────────────────

    public List<Issue> getAllDocuments() {
        return issueRepository.findAll();
    }

    public Issue getById(Long id) {
        return issueRepository.findById(id)
                .orElseThrow(() ->
                        new RuntimeException(
                                "Document not found with id: " + id
                        )
                );
    }

    public List<Issue> getByJobType(String jobType) {
        return issueRepository.findByJobType(jobType);
    }

    public List<Issue> getByStatus(String status) {
        return issueRepository.findByStatus(status);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PAGINATED + FILTERED DOCUMENTS
    // ─────────────────────────────────────────────────────────────────────

    public Page<Issue> getDocumentsPaged(
            int page,
            int size,
            String jobType,
            String status,
            String search,
            String date,
            List<String> divisionNos
    ) {
        Pageable pageable = PageRequest.of(
                Math.max(page, 0),
                Math.max(size, 1),
                Sort.by(
                        Sort.Direction.DESC,
                        "id"
                )
        );

        Specification<Issue> spec = buildSpec(
                jobType,
                status,
                search,
                date,
                divisionNos
        );

        return issueRepository.findAll(spec, pageable);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ALL JOB TYPES
    //
    // This is the important new method.
    //
    // The frontend must NOT build the Job Type dropdown from the current
    // 25 documents because pagination means only one page is available.
    //
    // Instead, this method asks the database for DISTINCT Job Types.
    // ─────────────────────────────────────────────────────────────────────

    public List<String> getAllJobTypes(List<String> divisionNos) {

        if (divisionNos != null && !divisionNos.isEmpty()) {
            return issueRepository.findDistinctJobTypesByDivisions(
                    divisionNos
            );
        }

        return issueRepository.findDistinctJobTypes();
    }

    // Convenience overload for comma-separated divisions
    public List<String> getAllJobTypes(String divisionsCsv) {
        return getAllJobTypes(
                toList(divisionsCsv)
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // STATS
    // ─────────────────────────────────────────────────────────────────────

    public Map<String, Long> getStats(
            String date,
            List<String> divisionNos
    ) {
        Specification<Issue> base = buildSpec(
                null,
                null,
                null,
                date,
                divisionNos
        );

        long total = issueRepository.count(base);

        long handedOver = issueRepository.count(
                withStatus(base, "HANDED_OVER")
        );

        long inProgress = issueRepository.count(
                withStatus(base, "IN_PROGRESS")
        );

        long onHold = issueRepository.count(
                withStatus(base, "ON_HOLD")
        );

        long completed = issueRepository.count(
                withStatus(base, "COMPLETED")
        );

        // Pending documents don't have a literal PENDING status.
        // Fresh documents have null/blank status.
        long pending = Math.max(
                total
                        - handedOver
                        - inProgress
                        - onHold
                        - completed,
                0
        );

        return Map.of(
                "total", total,
                "pending", pending,
                "handedOver", handedOver,
                "inProgress", inProgress,
                "onHold", onHold,
                "completed", completed
        );
    }

    // Convenience overload for comma-separated divisions
    public Map<String, Long> getStats(
            String date,
            String divisionsCsv
    ) {
        return getStats(
                date,
                toList(divisionsCsv)
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // STATUS SPECIFICATION
    // ─────────────────────────────────────────────────────────────────────

    private Specification<Issue> withStatus(
            Specification<Issue> base,
            String status
    ) {
        return base.and(
                (root, q, cb) ->
                        cb.equal(
                                root.get("status"),
                                status
                        )
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // COMMON FILTER SPECIFICATION
    // ─────────────────────────────────────────────────────────────────────

    private Specification<Issue> buildSpec(
            String jobType,
            String status,
            String search,
            String date,
            List<String> divisionNos
    ) {

        Specification<Issue> spec =
                Specification.where(null);

        // ─────────────────────────────────────────────
        // Job Type
        // ─────────────────────────────────────────────

        if (
                jobType != null
                        && !jobType.isBlank()
                        && !"ALL".equalsIgnoreCase(jobType)
        ) {
            spec = spec.and(
                    (root, q, cb) ->
                            cb.equal(
                                    root.get("jobType"),
                                    jobType
                            )
            );
        }

        // ─────────────────────────────────────────────
        // Status
        // ─────────────────────────────────────────────

        if (
                status != null
                        && !status.isBlank()
                        && !"ALL".equalsIgnoreCase(status)
        ) {

            if ("PENDING".equalsIgnoreCase(status)) {

                // Pending = null or blank status
                spec = spec.and(
                        (root, q, cb) ->
                                cb.or(
                                        cb.isNull(
                                                root.get("status")
                                        ),
                                        cb.equal(
                                                root.get("status"),
                                                ""
                                        )
                                )
                );

            } else {

                spec = spec.and(
                        (root, q, cb) ->
                                cb.equal(
                                        root.get("status"),
                                        status
                                )
                );
            }
        }

        // ─────────────────────────────────────────────
        // Search
        // ─────────────────────────────────────────────

        if (
                search != null
                        && !search.isBlank()
        ) {

            String like =
                    "%" + search.toLowerCase() + "%";

            spec = spec.and(
                    (root, q, cb) ->
                            cb.or(
                                    cb.like(
                                            cb.lower(
                                                    root.get("jobwbs")
                                            ),
                                            like
                                    ),
                                    cb.like(
                                            cb.lower(
                                                    root.get("reservationNo")
                                            ),
                                            like
                                    ),
                                    cb.like(
                                            cb.lower(
                                                    root.get("enteredBy")
                                            ),
                                            like
                                    ),
                                    cb.like(
                                            cb.lower(
                                                    root.get("jobType")
                                            ),
                                            like
                                    )
                            )
            );
        }

        // ─────────────────────────────────────────────
        // Date
        // requestDate is stored as String
        // ─────────────────────────────────────────────

        if (
                date != null
                        && !date.isBlank()
        ) {

            String trimmed =
                    date.trim();

            spec = spec.and(
                    (root, q, cb) ->
                            cb.equal(
                                    root.get("requestDate"),
                                    trimmed
                            )
            );
        }

        // ─────────────────────────────────────────────
        // Division permission filter
        // ─────────────────────────────────────────────

        if (
                divisionNos != null
                        && !divisionNos.isEmpty()
        ) {

            spec = spec.and(
                    (root, q, cb) ->
                            root.get("divisionNo")
                                    .in(divisionNos)
            );
        }

        // ─────────────────────────────────────────────
        // Pick Portal only shows documents that already
        // came through Print Portal.
        // ─────────────────────────────────────────────

        spec = spec.and(
                (root, q, cb) ->
                        cb.and(
                                cb.isNotNull(
                                        root.get("printDocumentNo")
                                ),
                                cb.notEqual(
                                        root.get("printDocumentNo"),
                                        ""
                                )
                        )
        );

        return spec;
    }

    // ─────────────────────────────────────────────────────────────────────
    // CSV DIVISION HELPER
    // ─────────────────────────────────────────────────────────────────────

    public Page<Issue> getDocumentsPaged(
            int page,
            int size,
            String jobType,
            String status,
            String search,
            String date,
            String divisionsCsv
    ) {

        return getDocumentsPaged(
                page,
                size,
                jobType,
                status,
                search,
                date,
                toList(divisionsCsv)
        );
    }

    private List<String> toList(String csv) {

        if (
                csv == null
                        || csv.isBlank()
        ) {
            return null;
        }

        return Arrays.asList(
                csv.split(",")
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // START / RESUME
    // ─────────────────────────────────────────────────────────────────────

    public Issue startPrint(Long id) {

        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getStatus())) {

            LocalDateTime now =
                    LocalDateTime.now();

            doc.setResumeTime(now);

            if (doc.getHoldTime() != null) {

                long holdSeconds =
                        Duration.between(
                                doc.getHoldTime(),
                                now
                        ).getSeconds();

                long existing =
                        doc.getTotalHoldSeconds() != null
                                ? doc.getTotalHoldSeconds()
                                : 0L;

                doc.setTotalHoldSeconds(
                        existing + holdSeconds
                );
            }

        } else {

            doc.setStartTime(
                    LocalDateTime.now()
            );

            doc.setTotalHoldSeconds(0L);
        }

        doc.setStatus("IN_PROGRESS");

        return issueRepository.save(doc);
    }

    // ─────────────────────────────────────────────────────────────────────
    // HOLD
    // ─────────────────────────────────────────────────────────────────────

    public Issue holdPrint(
            Long id,
            String holdReason,
            String heldBy
    ) {

        Issue doc = getById(id);

        doc.setStatus("ON_HOLD");

        doc.setHoldTime(
                LocalDateTime.now()
        );

        doc.setHoldReason(holdReason);
        doc.setHeldBy(heldBy);

        return issueRepository.save(doc);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PICK DONE / END
    // ─────────────────────────────────────────────────────────────────────

    public Issue endPrint(
            Long id,
            String pickedBy
    ) {

        Issue doc = getById(id);

        LocalDateTime endTime =
                LocalDateTime.now();

        doc.setStatus("COMPLETED");
        doc.setEndTime(endTime);
        doc.setPickedBy(pickedBy);

        if (doc.getStartTime() != null) {

            long totalElapsed =
                    Duration.between(
                            doc.getStartTime(),
                            endTime
                    ).getSeconds();

            long holdTime =
                    doc.getTotalHoldSeconds() != null
                            ? doc.getTotalHoldSeconds()
                            : 0L;

            long workingTime =
                    totalElapsed - holdTime;

            doc.setDurationSeconds(
                    Math.max(
                            workingTime,
                            0
                    )
            );
        }

        return issueRepository.save(doc);
    }

    // ─────────────────────────────────────────────────────────────────────
    // EMERGENCY PICK DONE
    // ─────────────────────────────────────────────────────────────────────

    public Issue emergencyResolve(
            Long id,
            String resolvedBy
    ) {

        Issue doc = getById(id);

        doc.setEmergencyPickResolved(true);

        doc.setEmergencyPickResolvedBy(
                resolvedBy
        );

        doc.setEmergencyResolvedTime(
                LocalDateTime.now()
        );

        return issueRepository.save(doc);
    }

    // ─────────────────────────────────────────────────────────────────────
    // DELETE
    // ─────────────────────────────────────────────────────────────────────

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }

    // ─────────────────────────────────────────────────────────────────────
    // HANDOVER
    // ─────────────────────────────────────────────────────────────────────

    public Issue handoverPrint(
            Long id,
            String handedOverBy
    ) {

        Issue doc = getById(id);

        doc.setStatus("HANDED_OVER");

        doc.setPrintHandedOverBy(
                handedOverBy
        );

        // Handover time intentionally unchanged
        // doc.setHandoverTime(LocalDateTime.now());

        return issueRepository.save(doc);
    }
}
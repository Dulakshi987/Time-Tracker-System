package com.service;

import com.dto.IssuePrintPageResponse;
import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class CheckPortalService {

    @Autowired
    private IssueRepository issueRepository;

    public List<Issue> getAllDocuments() {
        return issueRepository.findAll();
    }

    public Page<Issue> getDocumentsPaged(int page, int size) {
        int safePage = Math.max(page, 0);
        int safeSize = size <= 0 ? 10 : size;
        Pageable pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "id"));
        return issueRepository.findAll(pageable);
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
        if (heldBy != null && !heldBy.isBlank())    doc.setCheckHeldBy(heldBy);
        if (checkedBy != null && !checkedBy.isBlank()) doc.setCheckedBy(checkedBy);
        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }

    // ══════════════════════════════════════════════════════════════════
    // Request ID — computed over ALL eligible documents (before any
    // division / jobType / status / search filter), so the ID of a document
    // never changes when the user searches, filters or changes page.
    // Used by both search() and getPickingErrorAlerts().
    // ══════════════════════════════════════════════════════════════════
    private void assignRequestIds(List<Issue> eligible) {
        List<Issue> sorted = new ArrayList<>(eligible);
        sorted.sort(Comparator
                .comparing((Issue d) -> d.getRequestDate() == null ? "" : d.getRequestDate())
                .thenComparing(d -> d.getCreatedDatetime() == null ? LocalDate.MIN.atStartOfDay() : d.getCreatedDatetime())
                .thenComparing(Issue::getId));

        Map<String, Integer> counters = new HashMap<>();
        for (Issue d : sorted) {
            String key = d.getRequestDate() != null
                    ? d.getRequestDate().substring(0, Math.min(10, d.getRequestDate().length()))
                    : "unknown";
            int idx = counters.merge(key, 1, Integer::sum);
            String compactDate = "unknown".equals(key) ? "00000000" : key.replace("-", "");
            d.setRequestId(compactDate + "/" + String.format("%04d", idx));
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // Search + Pagination (server-side)
    // Only documents ready for check (Pick status = COMPLETED and has a
    // printDocumentNo) are ever considered.
    // ══════════════════════════════════════════════════════════════════
    public IssuePrintPageResponse search(
            String from, String to, String jobType, String status,
            String search, String divisionsCsv, int page, int size) {

        List<Issue> base;
        if (from != null || to != null) {
            String f = from != null ? from : "2000-01-01";
            String t = to != null ? to : LocalDate.now().toString();
            base = issueRepository.findByRequestDateBetween(f, t);
        } else {
            base = issueRepository.findAll();
        }

        // Ready-for-check gate
        base = base.stream()
                .filter(d -> matchesPickStatus(d.getStatus(), "completed"))
                .filter(d -> d.getPrintDocumentNo() != null && !d.getPrintDocumentNo().trim().isEmpty())
                .collect(Collectors.toList());

        // Request IDs — BEFORE division/jobType/status/search filters
        assignRequestIds(base);

        if (divisionsCsv != null && !divisionsCsv.isBlank()) {
            Set<String> allowed = Arrays.stream(divisionsCsv.split(","))
                    .map(String::trim).filter(s -> !s.isEmpty())
                    .collect(Collectors.toSet());
            base = base.stream()
                    .filter(d -> d.getDivisionNo() != null && allowed.contains(String.valueOf(d.getDivisionNo())))
                    .collect(Collectors.toList());
        }

        // Stats computed on the date+division scoped set (before jobType/status/search)
        long dTotal     = base.size();
        long dPending   = base.stream().filter(d -> matchesCheckStatus(d, "pending")).count();
        long dInProg    = base.stream().filter(d -> matchesCheckStatus(d, "inprogress")).count();
        long dOnHold    = base.stream().filter(d -> matchesCheckStatus(d, "onhold")).count();
        long dCompleted = base.stream().filter(d -> matchesCheckStatus(d, "completed")).count();

        if (jobType != null && !jobType.isBlank() && !"ALL".equalsIgnoreCase(jobType)) {
            base = base.stream()
                    .filter(d -> jobType.equalsIgnoreCase(d.getJobType()))
                    .collect(Collectors.toList());
        }

        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            base = base.stream().filter(d -> matchesCheckStatus(d, status))
                    .collect(Collectors.toList());
        }

        if (search != null && !search.isBlank()) {
            String q = search.toLowerCase();
            base = base.stream().filter(d ->
                    containsIgnoreCase(String.valueOf(d.getId()), q) ||
                    containsIgnoreCase(d.getRequestId(), q) ||
                    containsIgnoreCase(d.getPrintDocumentNo(), q) ||
                    containsIgnoreCase(d.getRequestedBy(), q) ||
                    containsIgnoreCase(d.getJobwbs(), q) ||
                    containsIgnoreCase(d.getReservationNo(), q) ||
                    containsIgnoreCase(d.getEnteredBy(), q) ||
                    containsIgnoreCase(d.getJobType(), q)
            ).collect(Collectors.toList());
        }

        base.sort(Comparator
                .comparing((Issue d) -> d.getRequestDate() == null ? "" : d.getRequestDate())
                .thenComparing(d -> d.getCreatedDatetime() == null ? LocalDate.MIN.atStartOfDay() : d.getCreatedDatetime())
                .thenComparing(Issue::getId));

        long total = base.size();
        int safeSize = Math.max(1, size);
        int totalPages = (int) Math.ceil((double) total / safeSize);
        int safePage = Math.max(0, Math.min(page, Math.max(0, totalPages - 1)));
        int fromIdx = safePage * safeSize;
        int toIdx = Math.min(fromIdx + safeSize, base.size());
        List<Issue> content = fromIdx < toIdx ? base.subList(fromIdx, toIdx) : Collections.emptyList();

        return new IssuePrintPageResponse(
                content, safePage, safeSize, total, totalPages,
                new IssuePrintPageResponse.Stats(dTotal, dPending, dInProg, dOnHold, dCompleted)
        );
    }

    // ── Lightweight endpoint for the red/green picking-error banners ──
    // Flagged, not-yet-check-completed docs only. Request IDs are assigned
    // over all eligible docs first, so they match the grid cards exactly.
    public List<Issue> getPickingErrorAlerts(String divisionsCsv) {
        List<Issue> eligible = issueRepository.findAll().stream()
                .filter(d -> matchesPickStatus(d.getStatus(), "completed"))
                .filter(d -> d.getPrintDocumentNo() != null && !d.getPrintDocumentNo().trim().isEmpty())
                .collect(Collectors.toList());

        assignRequestIds(eligible);

        List<Issue> base = eligible.stream()
                .filter(d -> "YES".equalsIgnoreCase(d.getHasWrongMaterial()))
                .filter(d -> !matchesCheckStatus(d, "completed"))
                .collect(Collectors.toList());

        if (divisionsCsv != null && !divisionsCsv.isBlank()) {
            Set<String> allowed = Arrays.stream(divisionsCsv.split(","))
                    .map(String::trim).filter(s -> !s.isEmpty())
                    .collect(Collectors.toSet());
            base = base.stream()
                    .filter(d -> d.getDivisionNo() != null && allowed.contains(String.valueOf(d.getDivisionNo())))
                    .collect(Collectors.toList());
        }
        return base;
    }

    // ── Distinct job types for the dropdown, without a full fetch ──
    public List<String> getDistinctJobTypes() {
        return issueRepository.findAll().stream()
                .filter(d -> matchesPickStatus(d.getStatus(), "completed"))
                .filter(d -> d.getPrintDocumentNo() != null && !d.getPrintDocumentNo().trim().isEmpty())
                .map(Issue::getJobType)
                .filter(Objects::nonNull)
                .filter(s -> !s.isBlank())
                .distinct()
                .sorted()
                .collect(Collectors.toList());
    }

    private boolean matchesPickStatus(String status, String wanted) {
        String v = status == null ? "" : status.toLowerCase();
        boolean isCompleted = v.contains("complete") || v.contains("done");
        return "completed".equalsIgnoreCase(wanted) ? isCompleted : true;
    }

    private boolean matchesCheckStatus(Issue d, String wanted) {
        String status = d.getCheckStatus();
        String v = status == null ? "" : status.toLowerCase();
        boolean isHold = v.contains("hold");
        boolean isProgress = v.contains("progress");
        boolean isCompleted = v.contains("complete") || v.contains("done");
        boolean isPending = !isHold && !isProgress && !isCompleted;

        boolean isFlagged = "YES".equalsIgnoreCase(d.getHasWrongMaterial());
        boolean resolved = Boolean.TRUE.equals(d.getEmergencyPickResolved());
        boolean unresolvedError = isFlagged && !resolved && !isCompleted;

        switch (wanted.toLowerCase()) {
            case "pending": return isPending || unresolvedError;
            case "inprogress": return isProgress;
            case "onhold": return isHold;
            case "completed": return isCompleted;
            default: return true;
        }
    }

    private boolean containsIgnoreCase(String value, String q) {
        return value != null && value.toLowerCase().contains(q);
    }
}
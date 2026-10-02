package com.service;

import com.dto.IssuePrintPageResponse;
import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class IssuePickService {

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
        return issueRepository.save(doc);
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
    // Search + Pagination
    // Pick Portal only shows documents that already have a printDocumentNo.
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

        base = base.stream()
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

        // Stats: date + division scoped (before jobType/status/search)
        long total      = base.size();
        long pending    = base.stream().filter(d -> matchesStatus(d.getStatus(), "pending")).count();
        long handedOver = base.stream().filter(d -> matchesStatus(d.getStatus(), "handedover")).count();
        long inProgress = base.stream().filter(d -> matchesStatus(d.getStatus(), "inprogress")).count();
        long onHold     = base.stream().filter(d -> matchesStatus(d.getStatus(), "onhold")).count();
        long completed  = base.stream().filter(d -> matchesStatus(d.getStatus(), "completed")).count();

        if (jobType != null && !jobType.isBlank() && !"ALL".equalsIgnoreCase(jobType)) {
            base = base.stream()
                    .filter(d -> jobType.equalsIgnoreCase(d.getJobType()))
                    .collect(Collectors.toList());
        }

        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            base = base.stream().filter(d -> matchesStatus(d.getStatus(), status))
                    .collect(Collectors.toList());
        }

        // Search: Request ID, Document No, WBS, Reservation No, Entered By, Job Type, Customer
        if (search != null && !search.isBlank()) {
            String q = search.toLowerCase();
            base = base.stream().filter(d ->
                    containsIgnoreCase(d.getRequestId(), q) ||
                    containsIgnoreCase(d.getPrintDocumentNo(), q) ||
                    containsIgnoreCase(d.getJobwbs(), q) ||
                    containsIgnoreCase(d.getReservationNo(), q) ||
                    containsIgnoreCase(d.getEnteredBy(), q) ||
                    containsIgnoreCase(d.getJobType(), q) ||
                    containsIgnoreCase(d.getCustomerName(), q)
            ).collect(Collectors.toList());
        }

        base.sort(Comparator
                .comparing((Issue d) -> d.getRequestDate() == null ? "" : d.getRequestDate())
                .thenComparing(d -> d.getCreatedDatetime() == null ? LocalDate.MIN.atStartOfDay() : d.getCreatedDatetime())
                .thenComparing(Issue::getId));

        long filteredTotal = base.size();
        int safeSize = Math.max(1, size);
        int totalPages = (int) Math.ceil((double) filteredTotal / safeSize);
        int safePage = Math.max(0, Math.min(page, Math.max(0, totalPages - 1)));
        int fromIdx = safePage * safeSize;
        int toIdx = Math.min(fromIdx + safeSize, base.size());
        List<Issue> content = fromIdx < toIdx ? base.subList(fromIdx, toIdx) : Collections.emptyList();

        return new IssuePrintPageResponse(
                content, safePage, safeSize, filteredTotal, totalPages,
                new IssuePrintPageResponse.Stats(total, pending, inProgress, onHold, completed, handedOver)
        );
    }

    // ── Picking-error banner/popup payload ──
    // Flagged + not yet re-picked docs, independent of page/search/filters.
    public List<Issue> getPickingErrorAlerts(String divisionsCsv) {
        List<Issue> eligible = issueRepository.findAll().stream()
                .filter(d -> d.getPrintDocumentNo() != null && !d.getPrintDocumentNo().trim().isEmpty())
                .collect(Collectors.toList());

        assignRequestIds(eligible);

        List<Issue> base = eligible.stream()
                .filter(d -> "YES".equalsIgnoreCase(d.getHasWrongMaterial()))
                .filter(d -> !Boolean.TRUE.equals(d.getEmergencyPickResolved()))
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

    // Distinct Job Types across ALL Pick-eligible documents
    public List<String> getDistinctJobTypes() {
        return issueRepository.findAll().stream()
                .filter(d -> d.getPrintDocumentNo() != null && !d.getPrintDocumentNo().trim().isEmpty())
                .map(Issue::getJobType)
                .filter(Objects::nonNull)
                .filter(s -> !s.isBlank())
                .distinct()
                .sorted()
                .collect(Collectors.toList());
    }

    private boolean matchesStatus(String status, String wanted) {
        String v = status == null ? "" : status.toLowerCase();
        boolean isHold = v.contains("hold");
        boolean isProgress = v.contains("progress");
        boolean isCompleted = v.contains("complete") || v.contains("done");
        boolean isHandedOver = v.contains("handed");
        switch (wanted.toLowerCase()) {
            case "onhold": return isHold;
            case "inprogress": return isProgress;
            case "completed": return isCompleted;
            case "handedover": return isHandedOver;
            case "pending": return !isHold && !isProgress && !isCompleted && !isHandedOver;
            default: return true;
        }
    }

    private boolean containsIgnoreCase(String value, String q) {
        return value != null && value.toLowerCase().contains(q);
    }
}
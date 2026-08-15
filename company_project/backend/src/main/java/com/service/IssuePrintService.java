package com.service;

import com.dto.IssuePrintPageResponse;
import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;
import java.util.Objects;

@Service
public class IssuePrintService {

    @Autowired
    private IssueRepository issueRepository;

    public List<Issue> getAllDocuments() {
        return issueRepository.findAll();
    }

    // Date-range filter — requestDate is stored as a String (YYYY-MM-DD),
    // so we compare as strings, not LocalDate.
    public List<Issue> getByDateRange(String from, String to) {
        if (from == null && to == null) {
            return issueRepository.findAll();
        }
        String f = from != null ? from : "2000-01-01";
        String t = to != null ? to : LocalDate.now().toString();
        return issueRepository.findByRequestDateBetween(f, t);
    }
    public List<String> getDistinctJobTypes() {
    return issueRepository.findAll().stream()
            .map(Issue::getJobType)
            .filter(Objects::nonNull)
            .filter(s -> !s.isBlank())
            .distinct()
            .sorted()
            .collect(Collectors.toList());
    }

    // Pagination — plain service method, NOT a REST endpoint.
    public Page<Issue> getAllPaged(Pageable pageable) {
        return issueRepository.findAll(pageable);
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

    // ══════════════════════════════════════════════════════════════════
    // ── Search + Pagination (new) ────────────────────────────────────
    // Filters, sorts, computes requestId + stats over the FULL filtered
    // set, then slices out just the requested page. Only that page's
    // rows go back to the client — cuts down Railway data usage.
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

        if (divisionsCsv != null && !divisionsCsv.isBlank()) {
            Set<String> allowed = Arrays.stream(divisionsCsv.split(","))
                    .map(String::trim).filter(s -> !s.isEmpty())
                    .collect(Collectors.toSet());
            base = base.stream()
                    .filter(d -> d.getDivisionNo() != null && allowed.contains(String.valueOf(d.getDivisionNo())))
                    .collect(Collectors.toList());
        }

        if (jobType != null && !jobType.isBlank() && !"ALL".equalsIgnoreCase(jobType)) {
            base = base.stream()
                    .filter(d -> jobType.equalsIgnoreCase(d.getJobType()))
                    .collect(Collectors.toList());
        }

        if (status != null && !status.isBlank() && !"ALL".equalsIgnoreCase(status)) {
            base = base.stream().filter(d -> matchesStatus(d.getPrintStatus(), status))
                    .collect(Collectors.toList());
        }

        if (search != null && !search.isBlank()) {
            String q = search.toLowerCase();
            base = base.stream().filter(d ->
                    containsIgnoreCase(String.valueOf(d.getId()), q) ||
                    containsIgnoreCase(d.getJobwbs(), q) ||
                    containsIgnoreCase(d.getReservationNo(), q) ||
                    containsIgnoreCase(d.getEnteredBy(), q) ||
                    containsIgnoreCase(d.getJobType(), q) ||
                    containsIgnoreCase(d.getRequestedBy(), q) ||
                    containsIgnoreCase(d.getVehicleNo(), q)
            ).collect(Collectors.toList());
        }

        // Sort — needed for stable request-ID numbering (matches old
        // frontend computeRequestIds() ordering: by createdDatetime, then id)
        base.sort(Comparator
                .comparing((Issue d) -> d.getRequestDate() == null ? "" : d.getRequestDate())
                .thenComparing(d -> d.getCreatedDatetime() == null ? LocalDate.MIN.atStartOfDay() : d.getCreatedDatetime())
                .thenComparing(Issue::getId));

        // Compute requestId per requestDate group — e.g. "20260815/0001"
        Map<String, Integer> counters = new HashMap<>();
        for (Issue d : base) {
            String key = d.getRequestDate() != null
                    ? d.getRequestDate().substring(0, Math.min(10, d.getRequestDate().length()))
                    : "unknown";
            int idx = counters.merge(key, 1, Integer::sum);
            String compactDate = "unknown".equals(key) ? "00000000" : key.replace("-", "");
            d.setRequestId(compactDate + "/" + String.format("%04d", idx));
        }

        // Stats over the FULL filtered set (before paging) — keeps the
        // stat chips accurate regardless of which page is being viewed.
        long total = base.size();
        long pending = base.stream().filter(d -> matchesStatus(d.getPrintStatus(), "pending")).count();
        long inProgress = base.stream().filter(d -> matchesStatus(d.getPrintStatus(), "inprogress")).count();
        long onHold = base.stream().filter(d -> matchesStatus(d.getPrintStatus(), "onhold")).count();
        long completed = base.stream().filter(d -> matchesStatus(d.getPrintStatus(), "completed")).count();

        int safeSize = Math.max(1, size);
        int totalPages = (int) Math.ceil((double) total / safeSize);
        int safePage = Math.max(0, Math.min(page, Math.max(0, totalPages - 1)));
        int fromIdx = safePage * safeSize;
        int toIdx = Math.min(fromIdx + safeSize, base.size());
        List<Issue> content = fromIdx < toIdx ? base.subList(fromIdx, toIdx) : Collections.emptyList();

        return new IssuePrintPageResponse(
                content, safePage, safeSize, total, totalPages,
                new IssuePrintPageResponse.Stats(total, pending, inProgress, onHold, completed)
        );
    }

    private boolean matchesStatus(String printStatus, String wanted) {
        String v = printStatus == null ? "" : printStatus.toLowerCase();
        boolean isHold = v.contains("hold");
        boolean isProgress = v.contains("progress");
        boolean isCompleted = v.contains("complete") || v.contains("done");
        switch (wanted.toLowerCase()) {
            case "onhold": return isHold;
            case "inprogress": return isProgress;
            case "completed": return isCompleted;
            case "pending": return !isHold && !isProgress && !isCompleted;
            default: return true;
        }
    }

    private boolean containsIgnoreCase(String value, String q) {
        return value != null && value.toLowerCase().contains(q);
    }

    // Document numbers already used by OTHER documents (for duplicate
    // check in the Print Done / Edit popup). excludeId is the document
    // currently being edited, so its own number doesn't self-block.
    public List<String> getUsedDocumentNumbers(Long excludeId) {
        return issueRepository.findAll().stream()
                .filter(d -> !d.getId().equals(excludeId))
                .map(Issue::getPrintDocumentNo)
                .filter(Objects::nonNull)
                .filter(s -> !s.isBlank())
                .distinct()
                .collect(Collectors.toList());
    }
}
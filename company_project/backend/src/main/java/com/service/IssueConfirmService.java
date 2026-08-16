package com.service;

import com.dto.IssueConfirmDto;
import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class IssueConfirmService {

    @Autowired
    private IssueRepository issueRepository;

    // Sri Lanka is always UTC+5:30, no DST — matches the frontend's
    // getSriLankaTodayKey() helper used across every portal.
    private static final ZoneId SL_ZONE = ZoneId.of("Asia/Colombo");

    // Only delivered / cancelled documents belong on the Confirm Portal.
    public List<Issue> getAllConfirmDocuments() {
        return issueRepository.findAll().stream()
                .filter(issue -> isConfirmRelevant(issue.getDeliveryStatus()))
                .collect(Collectors.toList());
    }

    // status param: delivered | cancelled
    public List<Issue> getByConfirmStatus(String status) {
        String normalized = normalize(status);
        return issueRepository.findAll().stream()
                .filter(issue -> normalize(issue.getDeliveryStatus()).equals(normalized))
                .collect(Collectors.toList());
    }

    public Issue getById(Long id) {
        return issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));
    }

    // "Add to File"
    public Issue addToFile(Long id, String reqId, String fileNumber) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        if (issue.getFileNumber() != null && !issue.getFileNumber().isEmpty()) {
            throw new IllegalStateException("Already added to file as " + issue.getFileNumber());
        }

        issue.setReqId(reqId);
        issue.setFileNumber(fileNumber);
        return issueRepository.save(issue);
    }

    // Edit an existing file number
    public Issue editFile(Long id, String newFileNumber) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        if (issue.getFileNumber() == null || issue.getFileNumber().isEmpty()) {
            throw new IllegalStateException("This document has not been added to a file yet");
        }

        issue.setFileNumber(newFileNumber);
        return issueRepository.save(issue);
    }

    // Remove file number (revert document to "not filed")
    public Issue removeFile(Long id) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        issue.setFileNumber(null);
        return issueRepository.save(issue);
    }

    // ── Edit Delivered/Cancelled detail fields ───────────────────────────
    // Only touches whichever of these keys are present in `fields`:
    //   deliveredBy, deliveryCancelReason, deliveryCancelledBy
    public Issue editStatusDetails(Long id, Map<String, String> fields) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        if (fields.containsKey("deliveredBy")) {
            issue.setDeliveredBy(fields.get("deliveredBy"));
        }
        if (fields.containsKey("deliveryCancelReason")) {
            issue.setDeliveryCancelReason(fields.get("deliveryCancelReason"));
        }
        if (fields.containsKey("deliveryCancelledBy")) {
            issue.setDeliveryCancelledBy(fields.get("deliveryCancelledBy"));
        }

        return issueRepository.save(issue);
    }

    // ── Permanently delete a document ────────────────────────────────────
    public void deleteIssue(Long id) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));
        issueRepository.delete(issue);
    }

    // ── NEW: paged + filtered + searched, for the Confirm Portal table ───
    // Does all filtering/searching/sorting/pagination server-side and
    // returns only one page of DTOs plus small stat totals — never the
    // full document list. Mirrors the Delivery Portal's /paged endpoint.
    public Map<String, Object> getConfirmPaged(
            int page, int size, String search, String status, String divisionNo,
            String dateMode, String fromDate, String toDate) {

        // 1) confirm-relevant only (delivered / cancelled)
        List<Issue> confirmRelevant = issueRepository.findAll().stream()
                .filter(i -> isConfirmRelevant(i.getDeliveryStatus()))
                .collect(Collectors.toList());

        // 2) division scope
        List<Issue> divisionScoped = confirmRelevant.stream()
                .filter(i -> divisionNo == null || divisionNo.isBlank() || "ALL".equalsIgnoreCase(divisionNo)
                        || divisionNo.equals(i.getDivisionNo()))
                .collect(Collectors.toList());

        // 3) date scope (Today / All / Custom range, Sri Lanka time)
        List<Issue> dateScoped = divisionScoped.stream()
                .filter(i -> matchesDate(i, dateMode, fromDate, toDate))
                .collect(Collectors.toList());

        // 4) assign sequential Req IDs (date-grouped, e.g. 20260816/0001)
        //    BEFORE search/status filtering, so numbering stays stable and
        //    matches Print/Pick/Check/Delivery Portal's scheme even while
        //    this table itself is paginated. Documents that already have a
        //    persisted reqId (added to file earlier) keep that value —
        //    this map is only used as a fallback in the DTO.
        Map<Long, String> reqIdMap = computeRequestIds(dateScoped);

        // 5) search scope (also matches against the assigned reqId)
        String q = search == null ? "" : search.trim().toLowerCase();
        List<Issue> searchScoped = q.isEmpty() ? dateScoped : dateScoped.stream()
                .filter(i -> matchesSearch(i, q, reqIdMap))
                .collect(Collectors.toList());

        // Stats reflect date + division + search scope only — NOT the
        // status filter — so the "Delivered / Cancelled / Filed" chips
        // always show true totals regardless of which chip is active.
        Map<String, Object> stats = buildStats(searchScoped);

        // 6) status filter: ALL | completed | cancelled | filed
        List<Issue> statusScoped = searchScoped.stream()
                .filter(i -> matchesStatus(i, status))
                .collect(Collectors.toList());

        // 7) newest first
        statusScoped.sort((a, b) -> {
            if (a.getCreatedDatetime() != null && b.getCreatedDatetime() != null) {
                return b.getCreatedDatetime().compareTo(a.getCreatedDatetime());
            }
            return Long.compare(b.getId(), a.getId());
        });

        int safeSize = Math.max(size, 1);
        int totalElements = statusScoped.size();
        int totalPages = (int) Math.ceil(totalElements / (double) safeSize);
        int from = Math.min(Math.max(page, 0) * safeSize, totalElements);
        int to = Math.min(from + safeSize, totalElements);
        List<Issue> pageContent = statusScoped.subList(from, to);

        List<IssueConfirmDto> dtoContent = pageContent.stream()
                .map(i -> IssueConfirmDto.from(i, reqIdMap.get(i.getId())))
                .collect(Collectors.toList());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("content", dtoContent);
        result.put("totalElements", totalElements);
        result.put("totalPages", totalPages);
        result.put("stats", stats);
        return result;
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private boolean isConfirmRelevant(String status) {
        if (status == null)
            return false;
        String v = status.toLowerCase();
        return v.contains("cancel") || v.contains("complete") || v.contains("done");
    }

    private String normalize(String status) {
        if (status == null)
            return "";
        String v = status.toLowerCase();
        if (v.contains("cancel"))
            return "cancelled";
        if (v.contains("complete") || v.contains("done"))
            return "delivered";
        return v;
    }

    private boolean matchesStatus(Issue i, String status) {
        if (status == null || status.isBlank() || "ALL".equalsIgnoreCase(status)) return true;
        if ("filed".equalsIgnoreCase(status)) {
            return i.getFileNumber() != null && !i.getFileNumber().isBlank();
        }
        // frontend passes "completed" for Delivered, "cancelled" for Cancelled
        String norm = normalize(i.getDeliveryStatus());
        String target = "completed".equalsIgnoreCase(status) ? "delivered" : status.toLowerCase();
        return norm.equals(target);
    }

    private boolean matchesSearch(Issue i, String q, Map<Long, String> reqIdMap) {
        String reqId = (i.getReqId() != null && !i.getReqId().isBlank())
                ? i.getReqId() : reqIdMap.getOrDefault(i.getId(), "");
        return containsIgnoreCase(reqId, q)
                || containsIgnoreCase(i.getPrintDocumentNo(), q)
                || containsIgnoreCase(i.getReservationNo(), q)
                || containsIgnoreCase(i.getJobwbs(), q)
                || containsIgnoreCase(i.getCustomerName(), q)
                || containsIgnoreCase(i.getRequestedBy(), q)
                || containsIgnoreCase(i.getDeliveryVehicleNo(), q)
                || containsIgnoreCase(i.getDeliveredBy(), q)
                || containsIgnoreCase(i.getDeliveryCancelledBy(), q)
                || containsIgnoreCase(i.getFileNumber(), q)
                || String.valueOf(i.getId()).contains(q);
    }

    private boolean containsIgnoreCase(String value, String q) {
        return value != null && value.toLowerCase().contains(q);
    }

    private boolean matchesDate(Issue i, String mode, String fromDate, String toDate) {
        if (mode == null || "ALL".equalsIgnoreCase(mode)) return true;

        String key = i.getRequestDate();

        if ("TODAY".equalsIgnoreCase(mode)) {
            String today = LocalDate.now(SL_ZONE).toString();
            return today.equals(key);
        }

        if ("CUSTOM".equalsIgnoreCase(mode)) {
            boolean noRange = (fromDate == null || fromDate.isBlank()) && (toDate == null || toDate.isBlank());
            if (noRange) return true;
            if (key == null || key.isBlank()) return false;
            if (fromDate != null && !fromDate.isBlank() && key.compareTo(fromDate) < 0) return false;
            if (toDate != null && !toDate.isBlank() && key.compareTo(toDate) > 0) return false;
            return true;
        }

        return true;
    }

    private Map<String, Object> buildStats(List<Issue> docs) {
        long delivered = docs.stream().filter(i -> "delivered".equals(normalize(i.getDeliveryStatus()))).count();
        long cancelled = docs.stream().filter(i -> "cancelled".equals(normalize(i.getDeliveryStatus()))).count();
        long filed = docs.stream().filter(i -> i.getFileNumber() != null && !i.getFileNumber().isBlank()).count();

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("total", docs.size());
        stats.put("completed", delivered); // key kept as "completed" to match frontend's filterStatus values
        stats.put("cancelled", cancelled);
        stats.put("filed", filed);
        return stats;
    }

    // Same date-grouped sequential numbering scheme used on the frontend
    // (Print/Pick/Check/Delivery Portal) — e.g. 20260816/0001 — computed
    // here so the Confirm Portal's Req ID stays correct across pages, and
    // is only used as a fallback for documents without a persisted reqId.
    private Map<Long, String> computeRequestIds(List<Issue> docs) {
        Map<String, List<Issue>> groups = new LinkedHashMap<>();
        for (Issue i : docs) {
            String key = (i.getRequestDate() != null && !i.getRequestDate().isBlank())
                    ? i.getRequestDate()
                    : (i.getCreatedDatetime() != null ? i.getCreatedDatetime().toLocalDate().toString() : "unknown");
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(i);
        }

        Map<Long, String> idMap = new HashMap<>();
        for (Map.Entry<String, List<Issue>> entry : groups.entrySet()) {
            String compactDate = "unknown".equals(entry.getKey()) ? "00000000" : entry.getKey().replace("-", "");
            List<Issue> group = entry.getValue();
            group.sort((a, b) -> {
                if (a.getCreatedDatetime() != null && b.getCreatedDatetime() != null) {
                    return a.getCreatedDatetime().compareTo(b.getCreatedDatetime());
                }
                return Long.compare(a.getId(), b.getId());
            });
            for (int idx = 0; idx < group.size(); idx++) {
                idMap.put(group.get(idx).getId(), compactDate + "/" + String.format("%04d", idx + 1));
            }
        }
        return idMap;
    }
}
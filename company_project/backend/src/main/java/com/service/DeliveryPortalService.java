package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import java.util.stream.Stream;

@Service
public class DeliveryPortalService {

    @Autowired
    private IssueRepository issueRepository;

    // ── Core: base "check-done" list, filtered — shared by list/stats/filter-options ──
    private List<Issue> getCheckDoneDocuments() {
        return issueRepository.findAll().stream()
                .filter(doc -> "COMPLETED".equalsIgnoreCase(doc.getCheckStatus())
                        || (doc.getCheckStatus() != null && doc.getCheckStatus().toLowerCase().contains("complete")))
                .collect(Collectors.toList());
    }

    private boolean matchesFilters(Issue doc, String jobType, String status, String division,
                                    String search, String dateMode, String fromDate, String toDate,
                                    String statFilter) {
        if (!isAllOrBlank(jobType) && !jobType.equalsIgnoreCase(doc.getJobType())) return false;
        if (!isAllOrBlank(status) && !status.equalsIgnoreCase(doc.getDeliveryStatus())) return false;
        if (!isAllOrBlank(division) && !division.equalsIgnoreCase(doc.getDivisionNo())) return false;

        if (!isAllOrBlank(statFilter)) {
            String cls = statusClass(doc.getDeliveryStatus());
            if (!statFilter.equalsIgnoreCase(cls)) return false;
        }

        if (search != null && !search.isBlank()) {
            String q = search.toLowerCase();
            boolean hit = Stream.of(
                    String.valueOf(doc.getId()), doc.getCustomerName(), doc.getJobwbs(),
                    doc.getReservationNo(), doc.getEnteredBy(), doc.getJobType(), doc.getPrintDocumentNo(),
                    doc.getRequestedBy(), doc.getVehicleNo(), doc.getDeliveryVehicleNo()
            ).anyMatch(v -> v != null && v.toLowerCase().contains(q));
            if (!hit) return false;
        }

        if (!matchesDate(doc, dateMode, fromDate, toDate)) return false;

        return true;
    }

    private boolean matchesDate(Issue doc, String mode, String fromDate, String toDate) {
        if (mode == null || mode.equalsIgnoreCase("ALL")) return true;

        String key = doc.getRequestDate() != null ? doc.getRequestDate().toString().substring(0, 10) : null;

        if (mode.equalsIgnoreCase("TODAY")) {
            String today = LocalDate.now(java.time.ZoneId.of("Asia/Colombo")).toString();
            return today.equals(key);
        }

        if (mode.equalsIgnoreCase("CUSTOM")) {
            if ((fromDate == null || fromDate.isBlank()) && (toDate == null || toDate.isBlank())) return true;
            if (key == null) return false;
            if (fromDate != null && !fromDate.isBlank() && key.compareTo(fromDate) < 0) return false;
            if (toDate != null && !toDate.isBlank() && key.compareTo(toDate) > 0) return false;
            return true;
        }

        return true;
    }

    private String statusClass(String s) {
        String v = s == null ? "" : s.toLowerCase();
        if (v.contains("cancel"))   return "cancelled";
        if (v.contains("hold"))     return "onhold";
        if (v.contains("progress")) return "inprogress";
        if (v.contains("complete") || v.contains("done")) return "completed";
        return "pending";
    }

    private long daysPending(Issue doc) {
        LocalDateTime requested = null;
        if (doc.getRequestDate() != null) {
            try {
                String rawTime = doc.getRequestTime() != null ? doc.getRequestTime().toString() : "00:00:00";
                requested = LocalDateTime.parse(doc.getRequestDate().toString().substring(0,10) + "T" + rawTime);
            } catch (Exception ignored) {}
        }
        if (requested == null && doc.getCreatedDatetime() != null) requested = doc.getCreatedDatetime();
        if (requested == null) return -1;
        return Duration.between(requested, LocalDateTime.now()).toDays();
    }

    private static final int OVERDUE_DAYS = 30;

    // ── PAGINATED LIST — this is what /api/delivery-portal returns now ──
    public Page<Issue> getAllDocuments(String jobType, String status, String division,
                                        String search, String dateMode, String fromDate, String toDate,
                                        String statFilter, Pageable pageable) {

        List<Issue> filtered = getCheckDoneDocuments().stream()
                .filter(doc -> matchesFilters(doc, jobType, status, division, search, dateMode, fromDate, toDate, statFilter))
                .collect(Collectors.toList());

        int start = (int) pageable.getOffset();
        if (start >= filtered.size()) {
            return new PageImpl<>(List.of(), pageable, filtered.size());
        }
        int end = Math.min(start + pageable.getPageSize(), filtered.size());
        return new PageImpl<>(filtered.subList(start, end), pageable, filtered.size());
    }

    // ── STATS — lightweight, only counts, not full row data ──
    public Map<String, Object> getStats(String dateMode, String fromDate, String toDate) {
        List<Issue> scoped = getCheckDoneDocuments().stream()
                .filter(doc -> matchesDate(doc, dateMode, fromDate, toDate))
                .collect(Collectors.toList());

        Map<String, Long> byClass = scoped.stream()
                .collect(Collectors.groupingBy(d -> statusClass(d.getDeliveryStatus()), Collectors.counting()));

        long overdue = scoped.stream()
                .filter(d -> daysPending(d) > OVERDUE_DAYS && !"completed".equals(statusClass(d.getDeliveryStatus())))
                .count();

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("total", scoped.size());
        stats.put("pending", byClass.getOrDefault("pending", 0L));
        stats.put("onHold", byClass.getOrDefault("onhold", 0L));
        stats.put("completed", byClass.getOrDefault("completed", 0L));
        stats.put("cancelled", byClass.getOrDefault("cancelled", 0L));
        stats.put("overdue", overdue);
        return stats;
    }

    // ── FILTER OPTIONS — distinct dropdown values, cheap, no row data ──
    public Map<String, Object> getFilterOptions() {
        List<Issue> all = getCheckDoneDocuments();
        Map<String, Object> opts = new LinkedHashMap<>();
        opts.put("jobTypes", all.stream().map(Issue::getJobType).filter(Objects::nonNull).distinct().sorted().collect(Collectors.toList()));
        opts.put("statuses", all.stream().map(Issue::getDeliveryStatus).filter(Objects::nonNull).distinct().sorted().collect(Collectors.toList()));
        opts.put("divisions", all.stream().map(Issue::getDivisionNo).filter(Objects::nonNull).distinct().sorted().collect(Collectors.toList()));
        return opts;
    }

    private boolean isAllOrBlank(String value) {
        return value == null || value.isBlank() || value.equalsIgnoreCase("ALL");
    }

    // ── everything below unchanged ──

    public Issue getById(Long id) {
        return issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Document not found with id: " + id));
    }

    public List<Issue> getByJobType(String jobType) {
        return issueRepository.findByJobType(jobType);
    }

    public List<Issue> getByDeliveryStatus(String status) {
        return issueRepository.findByDeliveryStatus(status);
    }

    public Issue holdDelivery(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);
        if (doc.getDeliveryHoldTime() != null && "ON_HOLD".equalsIgnoreCase(doc.getDeliveryStatus())) {
            LocalDateTime now = LocalDateTime.now();
            long holdSeconds = Duration.between(doc.getDeliveryHoldTime(), now).getSeconds();
            long existing = doc.getDeliveryTotalHoldSeconds() != null ? doc.getDeliveryTotalHoldSeconds() : 0L;
            doc.setDeliveryTotalHoldSeconds(existing + holdSeconds);
        }
        doc.setDeliveryStatus("ON_HOLD");
        doc.setDeliveryHoldTime(LocalDateTime.now());
        doc.setDeliveryHoldReason(holdReason);
        doc.setDeliveryHeldBy(heldBy);
        return issueRepository.save(doc);
    }

    public Issue endDelivery(Long id, String deliveredBy, String vehicleNo) {
        Issue doc = getById(id);
        LocalDateTime endTime = LocalDateTime.now();
        if ("ON_HOLD".equalsIgnoreCase(doc.getDeliveryStatus()) && doc.getDeliveryHoldTime() != null) {
            doc.setDeliveryResumeTime(endTime);
            long holdSeconds = Duration.between(doc.getDeliveryHoldTime(), endTime).getSeconds();
            long existing = doc.getDeliveryTotalHoldSeconds() != null ? doc.getDeliveryTotalHoldSeconds() : 0L;
            doc.setDeliveryTotalHoldSeconds(existing + holdSeconds);
        }
        doc.setDeliveryStatus("COMPLETED");
        doc.setDeliveryEndTime(endTime);
        doc.setDeliveredBy(deliveredBy);
        doc.setDeliveryVehicleNo(vehicleNo);
        LocalDateTime start = doc.getDeliveryStartTime() != null ? doc.getDeliveryStartTime() : doc.getCheckEndTime();
        if (start != null) {
            long totalElapsed = Duration.between(start, endTime).getSeconds();
            long holdTime     = doc.getDeliveryTotalHoldSeconds() != null ? doc.getDeliveryTotalHoldSeconds() : 0L;
            doc.setDeliveryDurationSeconds(Math.max(totalElapsed - holdTime, 0));
        }
        return issueRepository.save(doc);
    }

    public Issue cancelDelivery(Long id, String cancelReason, String cancelledBy) {
        Issue doc = getById(id);
        doc.setDeliveryStatus("CANCELLED");
        doc.setDeliveryCancelReason(cancelReason);
        doc.setDeliveryCancelledBy(cancelledBy);
        doc.setDeliveryCancelTime(LocalDateTime.now());
        return issueRepository.save(doc);
    }

    public Issue handoverDelivery(Long id, String handoverBy) {
        Issue doc = getById(id);
        doc.setHandoverBy(handoverBy);
        doc.setHandoverTime(LocalDateTime.now());
        return issueRepository.save(doc);
    }

    public Issue reactivateDelivery(Long id) {
        Issue doc = getById(id);
        doc.setHandoverBy(null);
        doc.setHandoverTime(null);
        doc.setDeliveryStatus("PENDING");
        return issueRepository.save(doc);
    }

    public Issue editDelivery(Long id, String heldBy, String cancelledBy, String deliveredBy) {
        Issue doc = getById(id);
        if (heldBy != null)      doc.setDeliveryHeldBy(heldBy);
        if (cancelledBy != null) doc.setDeliveryCancelledBy(cancelledBy);
        if (deliveredBy != null) doc.setDeliveredBy(deliveredBy);
        return issueRepository.save(doc);
    }

    public Issue updateVehicleNo(Long id, String vehicleNo) {
        Issue doc = getById(id);
        doc.setVehicleNo(vehicleNo);
        return issueRepository.save(doc);
    }

    public Issue updateDeliveryVehicleNo(Long id, String deliveryVehicleNo) {
        Issue doc = getById(id);
        doc.setDeliveryVehicleNo(deliveryVehicleNo);
        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
package com.service;

import com.dto.IssueDeliveryPageResponse;
import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class DeliveryPortalService {

    @Autowired
    private IssueRepository issueRepository;

    private static final ZoneId COLOMBO = ZoneId.of("Asia/Colombo");
    private static final int OVERDUE_DAYS = 30;

    // Only Check-Done documents belong on the Delivery Portal.
    public List<Issue> getAllDocuments() {
        return issueRepository.findAll().stream()
                .filter(doc -> "COMPLETED".equalsIgnoreCase(doc.getCheckStatus())
                        || (doc.getCheckStatus() != null && doc.getCheckStatus().toLowerCase().contains("complete")))
                .collect(Collectors.toList());
    }

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

    // ─────────────────────────────────────────────────────────────────────
    // Paginated + filtered read for the Delivery Portal UI.
    //
    // Everything (search / job type / status / division / date range /
    // stat-chip filter) is applied server-side, and only the current page
    // of matching rows is ever sent back — this is what actually cuts the
    // Railway egress / mobile data usage down, since the frontend used to
    // pull every Check-Done document on every load and every action.
    //
    // allowedDivisionsCsv: comma-separated divisionNo list. Pass null/blank
    // for admin/System Administrator (no restriction). For every other
    // login, the frontend sends the caller's own assigned division(s), so
    // a non-admin can never pull another division's rows just by tweaking
    // query params — same access rule the old frontend enforced client-side,
    // just now also enforced on the server.
    // ─────────────────────────────────────────────────────────────────────
    public IssueDeliveryPageResponse getPagedDeliveryDocuments(
            int page, int size, String search, String jobType, String status,
            String divisionNo, String allowedDivisionsCsv, String dateMode,
            String fromDate, String toDate, String statFilter) {

        if (page < 0) page = 0;
        if (size <= 0) size = 25;
        if (size > 200) size = 200; // hard ceiling so a bad query string can't ask for everything at once

        List<Issue> all = getAllDocuments();

        if (allowedDivisionsCsv != null && !allowedDivisionsCsv.isBlank()) {
            Set<String> allowed = Arrays.stream(allowedDivisionsCsv.split(","))
                    .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
            all = all.stream()
                    .filter(d -> d.getDivisionNo() != null && allowed.contains(d.getDivisionNo()))
                    .collect(Collectors.toList());
        }

        // Date-scoped set drives the stat chips (Total / Pending / On Hold /
        // Delivered / Cancelled / Overdue) — same semantics as before:
        // "Today" only counts today's requests, "All" counts everything.
        List<Issue> dateScoped = all.stream()
                .filter(d -> matchesDateFilter(d, dateMode, fromDate, toDate))
                .collect(Collectors.toList());

        long total     = dateScoped.size();
        long pending   = dateScoped.stream().filter(d -> "pending".equals(statusClass(d.getDeliveryStatus()))).count();
        long onHold    = dateScoped.stream().filter(d -> "onhold".equals(statusClass(d.getDeliveryStatus()))).count();
        long completed = dateScoped.stream().filter(d -> "completed".equals(statusClass(d.getDeliveryStatus()))).count();
        long cancelled = dateScoped.stream().filter(d -> "cancelled".equals(statusClass(d.getDeliveryStatus()))).count();
        long overdue   = dateScoped.stream().filter(this::isOverdue).count();

        IssueDeliveryPageResponse.Stats stats =
                new IssueDeliveryPageResponse.Stats(total, pending, onHold, completed, cancelled, overdue);

        List<Issue> filtered = dateScoped.stream()
                .filter(d -> matchesSearch(d, search))
                .filter(d -> jobType == null || jobType.isBlank() || "ALL".equalsIgnoreCase(jobType) || jobType.equalsIgnoreCase(d.getJobType()))
                .filter(d -> status == null || status.isBlank() || "ALL".equalsIgnoreCase(status) || status.equalsIgnoreCase(d.getDeliveryStatus()))
                .filter(d -> divisionNo == null || divisionNo.isBlank() || "ALL".equalsIgnoreCase(divisionNo) || divisionNo.equals(d.getDivisionNo()))
                .filter(d -> statFilter == null || statFilter.isBlank() || "ALL".equalsIgnoreCase(statFilter) || statFilter.equalsIgnoreCase(statusClass(d.getDeliveryStatus())))
                .sorted(Comparator.comparing(
                        (Issue d) -> d.getCreatedDatetime() != null ? d.getCreatedDatetime() : LocalDateTime.MIN)
                        .reversed())
                .collect(Collectors.toList());

        int totalElements = filtered.size();
        int totalPages = (int) Math.ceil(totalElements / (double) size);
        int from = Math.min(page * size, totalElements);
        int to = Math.min(from + size, totalElements);
        List<Issue> content = filtered.subList(from, to);

        return new IssueDeliveryPageResponse(content, page, size, totalElements, totalPages, stats);
    }

    // Distinct Job Type values currently present on the portal — tiny
    // payload so the "Job Type" filter dropdown stays accurate without
    // downloading every document just to build the option list. Returned
    // as a plain List<String> (no dedicated DTO file needed).
    public List<String> getFilterOptions() {
        return getAllDocuments().stream()
                .map(Issue::getJobType)
                .filter(jt -> jt != null && !jt.isBlank())
                .collect(Collectors.toCollection(LinkedHashSet::new))
                .stream().sorted().collect(Collectors.toList());
    }

    private boolean matchesSearch(Issue d, String q) {
        if (q == null || q.isBlank()) return true;
        String needle = q.toLowerCase();
        String[] fields = {
                String.valueOf(d.getId()), d.getCustomerName(), d.getJobwbs(), d.getReservationNo(),
                d.getEnteredBy(), d.getJobType(), d.getPrintDocumentNo(), d.getRequestedBy(),
                d.getVehicleNo(), d.getDeliveryVehicleNo()
        };
        for (String f : fields) {
            if (f != null && f.toLowerCase().contains(needle)) return true;
        }
        return false;
    }

    // requestDate is stored as a plain date string (no time/timezone), so a
    // straight substring/string comparison against yyyy-MM-dd keys is
    // correct as-is — same assumption the old frontend made.
    private boolean matchesDateFilter(Issue d, String mode, String fromDate, String toDate) {
        if (mode == null || mode.isBlank() || "ALL".equalsIgnoreCase(mode)) return true;

        String key = (d.getRequestDate() != null && d.getRequestDate().length() >= 10)
                ? d.getRequestDate().substring(0, 10) : null;

        if ("TODAY".equalsIgnoreCase(mode)) {
            return key != null && key.equals(sriLankaTodayKey());
        }

        if ("CUSTOM".equalsIgnoreCase(mode)) {
            boolean noRange = (fromDate == null || fromDate.isBlank()) && (toDate == null || toDate.isBlank());
            if (noRange) return true;
            if (key == null) return false;
            if (fromDate != null && !fromDate.isBlank() && key.compareTo(fromDate) < 0) return false;
            if (toDate != null && !toDate.isBlank() && key.compareTo(toDate) > 0) return false;
            return true;
        }

        return true;
    }

    private String sriLankaTodayKey() {
        return LocalDate.now(COLOMBO).toString(); // yyyy-MM-dd
    }

    private String statusClass(String s) {
        String v = s == null ? "" : s.toLowerCase();
        if (v.contains("cancel")) return "cancelled";
        if (v.contains("hold")) return "onhold";
        if (v.contains("progress")) return "inprogress";
        if (v.contains("complete") || v.contains("done")) return "completed";
        return "pending";
    }

    private boolean isOverdue(Issue d) {
        if ("completed".equals(statusClass(d.getDeliveryStatus()))) return false;
        LocalDateTime requested = getRequestDateTime(d);
        if (requested == null) requested = d.getCreatedDatetime();
        if (requested == null) return false;
        long days = Duration.between(requested, LocalDateTime.now()).toDays();
        return days > OVERDUE_DAYS;
    }

    private LocalDateTime getRequestDateTime(Issue d) {
        if (d.getRequestDate() == null) return null;
        try {
            String rawTime = d.getRequestTime() == null ? "00:00:00" : d.getRequestTime().trim();
            String[] parts = rawTime.split(":");
            String hh = parts.length > 0 ? pad(parts[0]) : "00";
            String mm = parts.length > 1 ? pad(parts[1]) : "00";
            String ss = parts.length > 2 ? pad(parts[2]) : "00";
            return LocalDateTime.parse(d.getRequestDate() + "T" + hh + ":" + mm + ":" + ss);
        } catch (Exception e) {
            return null;
        }
    }

    private String pad(String s) {
        return s.length() == 1 ? "0" + s : s;
    }

    // body: { holdReason, heldBy }
    public Issue holdDelivery(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);

        // Accumulate any prior hold period before starting a new one, same
        // pattern as Pick/Check (Delivery has no explicit Resume button —
        // the next action, whatever it is, effectively resumes).
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

    // body: { deliveredBy, vehicleNo } — vehicleNo maps to deliveryVehicleNo
    public Issue endDelivery(Long id, String deliveredBy, String vehicleNo) {
        Issue doc = getById(id);

        LocalDateTime endTime = LocalDateTime.now();

        // Close out any open hold period before finalising.
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

    // body: { cancelReason, cancelledBy }
    public Issue cancelDelivery(Long id, String cancelReason, String cancelledBy) {
        Issue doc = getById(id);

        doc.setDeliveryStatus("CANCELLED");
        doc.setDeliveryCancelReason(cancelReason);
        doc.setDeliveryCancelledBy(cancelledBy);
        doc.setDeliveryCancelTime(LocalDateTime.now());

        return issueRepository.save(doc);
    }

    // body: { handoverBy }
    // Can only meaningfully be called from the frontend while the row is
    // ON_HOLD or CANCELLED (enforced client-side); stamps who handed the
    // document over and when. This is what causes the Delivery Portal row
    // to lock (Delivered / Hold / Cancel / Delete) until it's reactivated.
    public Issue handoverDelivery(Long id, String handoverBy) {
        Issue doc = getById(id);

        doc.setHandoverBy(handoverBy);
        doc.setHandoverTime(LocalDateTime.now());

        return issueRepository.save(doc);
    }

    // Reactivate — reverses a Handover. Clears the handover stamp AND resets
    // deliveryStatus back to PENDING so the Delivery Portal row actually
    // unlocks (ON_HOLD / CANCELLED status locks the row on its own, so
    // clearing handoverBy alone would not be enough).
    public Issue reactivateDelivery(Long id) {
        Issue doc = getById(id);

        doc.setHandoverBy(null);
        doc.setHandoverTime(null);
        doc.setDeliveryStatus("PENDING");

        return issueRepository.save(doc);
    }

    // body: { heldBy, cancelledBy, deliveredBy }
    // Lets an admin correct who was recorded against Hold / Cancel / Delivered
    // after the fact, without re-running those actions. Any field left null
    // in the request is left untouched.
    public Issue editDelivery(Long id, String heldBy, String cancelledBy, String deliveredBy) {
        Issue doc = getById(id);

        if (heldBy != null)      doc.setDeliveryHeldBy(heldBy);
        if (cancelledBy != null) doc.setDeliveryCancelledBy(cancelledBy);
        if (deliveredBy != null) doc.setDeliveredBy(deliveredBy);

        return issueRepository.save(doc);
    }

    // Request-time vehicle number (doc.vehicleNo)
    public Issue updateVehicleNo(Long id, String vehicleNo) {
        Issue doc = getById(id);
        doc.setVehicleNo(vehicleNo);
        return issueRepository.save(doc);
    }

    // Delivery-time vehicle number (doc.deliveryVehicleNo)
    public Issue updateDeliveryVehicleNo(Long id, String deliveryVehicleNo) {
        Issue doc = getById(id);
        doc.setDeliveryVehicleNo(deliveryVehicleNo);
        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
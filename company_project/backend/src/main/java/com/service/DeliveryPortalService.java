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
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class DeliveryPortalService {

    @Autowired
    private IssueRepository issueRepository;

    private static final ZoneId COLOMBO = ZoneId.of("Asia/Colombo");
    // Hard ceiling so a stray ?size=100000 can't undo the point of pagination.
    private static final int MAX_PAGE_SIZE = 200;

    // ── Reusable filter fragments ───────────────────────────────────────

    // Only Check-Done documents ever belong on the Delivery Portal.
    private Specification<Issue> completedCheckSpec() {
        return (root, query, cb) -> cb.like(cb.lower(root.get("checkStatus")), "%complete%");
    }

    // divisionNo: a single division picked in the dropdown ("ALL" = no filter).
    // allowedDivisions: the divisions this *logged-in user* is permitted to see
    // (null/empty = admin / all-division access). Both narrow the same field;
    // pass one or the other from the controller depending on the caller's role.
    private Specification<Issue> divisionScopeSpec(String divisionNo, List<String> allowedDivisions) {
        return (root, query, cb) -> {
            if (divisionNo != null && !divisionNo.isBlank() && !"ALL".equalsIgnoreCase(divisionNo)) {
                return cb.equal(root.get("divisionNo"), divisionNo);
            }
            if (allowedDivisions != null && !allowedDivisions.isEmpty()) {
                return root.get("divisionNo").in(allowedDivisions);
            }
            return cb.conjunction();
        };
    }

    private Specification<Issue> jobTypeSpec(String jobType) {
        return (root, query, cb) -> ("ALL".equalsIgnoreCase(jobType) || jobType == null || jobType.isBlank())
                ? cb.conjunction()
                : cb.equal(root.get("jobType"), jobType);
    }

    private Specification<Issue> statusSpec(String status) {
        return (root, query, cb) -> ("ALL".equalsIgnoreCase(status) || status == null || status.isBlank())
                ? cb.conjunction()
                : cb.equal(root.get("deliveryStatus"), status);
    }

    // Groups deliveryStatus the same way the frontend's statusClass() does.
    private Specification<Issue> statClassSpec(String statClass) {
        return (root, query, cb) -> {
            if (statClass == null || statClass.isBlank() || "ALL".equalsIgnoreCase(statClass)) return cb.conjunction();
            switch (statClass.toLowerCase()) {
                case "onhold":    return cb.equal(root.get("deliveryStatus"), "ON_HOLD");
                case "completed": return cb.equal(root.get("deliveryStatus"), "COMPLETED");
                case "cancelled": return cb.equal(root.get("deliveryStatus"), "CANCELLED");
                case "pending":
                default:
                    return cb.or(
                            cb.isNull(root.get("deliveryStatus")),
                            cb.not(root.get("deliveryStatus").in("ON_HOLD", "COMPLETED", "CANCELLED"))
                    );
            }
        };
    }

    private Specification<Issue> searchSpec(String search) {
        return (root, query, cb) -> {
            if (search == null || search.isBlank()) return cb.conjunction();
            String like = "%" + search.toLowerCase() + "%";
            return cb.or(
                    cb.like(cb.lower(root.get("customerName")), like),
                    cb.like(cb.lower(root.get("jobwbs")), like),
                    cb.like(cb.lower(root.get("reservationNo")), like),
                    cb.like(cb.lower(root.get("enteredBy")), like),
                    cb.like(cb.lower(root.get("printDocumentNo")), like),
                    cb.like(cb.lower(root.get("requestedBy")), like),
                    cb.like(cb.lower(root.get("vehicleNo")), like),
                    cb.like(cb.lower(root.get("deliveryVehicleNo")), like)
            );
        };
    }

    // NOTE: assumes requestDate is a String column in "YYYY-MM-DD" format,
    // same as requestTime is handled elsewhere in this codebase. If your
    // Issue entity actually declares requestDate as java.time.LocalDate,
    // replace the String comparisons below with:
    //   cb.equal(root.get("requestDate"), LocalDate.now(COLOMBO))
    //   cb.greaterThanOrEqualTo(root.get("requestDate"), LocalDate.parse(fromDate))
    //   cb.lessThanOrEqualTo(root.get("requestDate"), LocalDate.parse(toDate))
    private Specification<Issue> dateFilterSpec(String mode, String fromDate, String toDate) {
        return (root, query, cb) -> {
            if (mode == null || "ALL".equalsIgnoreCase(mode)) return cb.conjunction();

            if ("TODAY".equalsIgnoreCase(mode)) {
                String today = LocalDate.now(COLOMBO).toString();
                return cb.equal(root.get("requestDate"), today);
            }

            // CUSTOM
            List<jakarta.persistence.criteria.Predicate> preds = new ArrayList<>();
            if (fromDate != null && !fromDate.isBlank()) {
                preds.add(cb.greaterThanOrEqualTo(root.get("requestDate"), fromDate));
            }
            if (toDate != null && !toDate.isBlank()) {
                preds.add(cb.lessThanOrEqualTo(root.get("requestDate"), toDate));
            }
            return preds.isEmpty() ? cb.conjunction() : cb.and(preds.toArray(new jakarta.persistence.criteria.Predicate[0]));
        };
    }

    // ── Paginated + filtered document list (the main table call) ────────
    public Page<Issue> getDocuments(int page, int size, String search, String jobType, String status,
                                     String statClass, String divisionNo, List<String> allowedDivisions,
                                     String dateMode, String fromDate, String toDate) {

        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);

        Specification<Issue> spec = Specification.where(completedCheckSpec())
                .and(divisionScopeSpec(divisionNo, allowedDivisions))
                .and(jobTypeSpec(jobType))
                .and(statusSpec(status))
                .and(statClassSpec(statClass))
                .and(searchSpec(search))
                .and(dateFilterSpec(dateMode, fromDate, toDate));

        Pageable pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "id"));
        return issueRepository.findAll(spec, pageable);
    }

    // ── Stats: counts only, never loads full rows ────────────────────────
    // Scoped by division ACCESS + the date filter only (not search/type/
    // status), same as the old frontend behaviour — chips always show the
    // true breakdown for the selected date range regardless of what's typed
    // into the search box.
    public Map<String, Object> getStats(String divisionNo, List<String> allowedDivisions,
                                         String dateMode, String fromDate, String toDate) {

        Specification<Issue> base = Specification.where(completedCheckSpec())
                .and(divisionScopeSpec(divisionNo, allowedDivisions))
                .and(dateFilterSpec(dateMode, fromDate, toDate));

        long total     = issueRepository.count(base);
        long onHold    = issueRepository.count(base.and(statClassSpec("onhold")));
        long completed = issueRepository.count(base.and(statClassSpec("completed")));
        long cancelled = issueRepository.count(base.and(statClassSpec("cancelled")));
        long pending   = total - onHold - completed - cancelled;

        // NOTE: same requestDate-as-String assumption as dateFilterSpec above.
        String overdueCutoff = LocalDate.now(COLOMBO).minusDays(30).toString();
        Specification<Issue> overdueSpec = base
                .and((root, query, cb) -> cb.lessThan(root.get("requestDate"), overdueCutoff))
                .and((root, query, cb) -> cb.notEqual(root.get("deliveryStatus"), "COMPLETED"));
        long overdue = issueRepository.count(overdueSpec);

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("total", total);
        stats.put("pending", pending);
        stats.put("onHold", onHold);
        stats.put("completed", completed);
        stats.put("cancelled", cancelled);
        stats.put("overdue", overdue);
        return stats;
    }

    // ── Req ID numbering (e.g. 20260816/0001) ────────────────────────────
    // Same date-grouped sequential scheme as before, just computed once
    // here instead of re-derived from the full document list on every
    // client. TODO(optional perf): switch this to a projection query
    // (id, requestDate, createdDatetime only) once you confirm the exact
    // field types on Issue — right now it still loads full rows.
    public Map<Long, String> getRequestIdNumbering(String divisionNo, List<String> allowedDivisions) {
        Specification<Issue> spec = Specification.where(completedCheckSpec())
                .and(divisionScopeSpec(divisionNo, allowedDivisions));

        List<Issue> docs = issueRepository.findAll(spec);

        Map<String, List<Issue>> byDate = docs.stream().collect(Collectors.groupingBy(d ->
                d.getRequestDate() != null ? d.getRequestDate().toString().substring(0, 10)
                        : (d.getCreatedDatetime() != null ? d.getCreatedDatetime().toString().substring(0, 10) : "unknown")
        ));

        Map<Long, String> idMap = new HashMap<>();
        byDate.forEach((dateKey, group) -> {
            String compact = "unknown".equals(dateKey) ? "00000000" : dateKey.replace("-", "");
            List<Issue> sorted = group.stream()
                    .sorted(Comparator.comparing(d -> d.getCreatedDatetime() != null ? d.getCreatedDatetime() : LocalDateTime.MIN))
                    .collect(Collectors.toList());
            for (int i = 0; i < sorted.size(); i++) {
                idMap.put(sorted.get(i).getId(), compact + "/" + String.format("%04d", i + 1));
            }
        });
        return idMap;
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

    // body: { holdReason, heldBy }
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

    // body: { deliveredBy, vehicleNo } — vehicleNo maps to deliveryVehicleNo
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
    public Issue handoverDelivery(Long id, String handoverBy) {
        Issue doc = getById(id);

        doc.setHandoverBy(handoverBy);
        doc.setHandoverTime(LocalDateTime.now());

        return issueRepository.save(doc);
    }

    // Reactivate — reverses a Handover.
    public Issue reactivateDelivery(Long id) {
        Issue doc = getById(id);

        doc.setHandoverBy(null);
        doc.setHandoverTime(null);
        doc.setDeliveryStatus("PENDING");

        return issueRepository.save(doc);
    }

    // body: { heldBy, cancelledBy, deliveredBy }
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

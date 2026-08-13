package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;


@Service
public class DeliveryPortalService {

    @Autowired
    private IssueRepository issueRepository;

    public Page<Issue> getAllDocuments(String jobType, String status, Pageable pageable) {

    List<Issue> completedDocs = issueRepository.findAll().stream()
            .filter(doc -> "COMPLETED".equalsIgnoreCase(doc.getCheckStatus())
                    || (doc.getCheckStatus() != null && doc.getCheckStatus().toLowerCase().contains("complete")))
            .filter(doc -> isAllOrBlank(jobType) || jobType.equalsIgnoreCase(doc.getJobType()))
            .filter(doc -> isAllOrBlank(status) || status.equalsIgnoreCase(doc.getDeliveryStatus()))
            .collect(Collectors.toList());

    int start = (int) pageable.getOffset();
    if (start >= completedDocs.size()) {
        return new PageImpl<>(List.of(), pageable, completedDocs.size());
    }
    int end = Math.min(start + pageable.getPageSize(), completedDocs.size());

    return new PageImpl<>(completedDocs.subList(start, end), pageable, completedDocs.size());
}

private boolean isAllOrBlank(String value) {
    return value == null || value.isBlank() || value.equalsIgnoreCase("ALL");
}

    // Only Check-Done documents belong on the Delivery Portal.
    // public List<Issue> getAllDocuments() {
    //     return issueRepository.findAll().stream()
    //             .filter(doc -> "COMPLETED".equalsIgnoreCase(doc.getCheckStatus())
    //                     || (doc.getCheckStatus() != null && doc.getCheckStatus().toLowerCase().contains("complete")))
    //             .collect(Collectors.toList());
    // }

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
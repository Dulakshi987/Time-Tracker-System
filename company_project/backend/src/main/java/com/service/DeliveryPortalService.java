package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class DeliveryPortalService {

    @Autowired
    private IssueRepository issueRepository;

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
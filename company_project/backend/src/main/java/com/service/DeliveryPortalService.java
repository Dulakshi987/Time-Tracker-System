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

    // ── Get only documents where Check Portal is COMPLETED ─────────────
    public List<Issue> getAllDocuments() {
        return issueRepository.findAll()
                .stream()
                .filter(doc -> "COMPLETED".equalsIgnoreCase(doc.getCheckStatus()))
                .collect(Collectors.toList());
    }

    public Issue getById(Long id) {
        Issue doc = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Document not found with id: " + id));
        if (!"COMPLETED".equalsIgnoreCase(doc.getCheckStatus())) {
            throw new RuntimeException("Document is not Check Done yet, cannot access Delivery Portal");
        }
        return doc;
    }

    public List<Issue> getByJobType(String jobType) {
        return issueRepository.findByJobType(jobType)
                .stream()
                .filter(doc -> "COMPLETED".equalsIgnoreCase(doc.getCheckStatus()))
                .collect(Collectors.toList());
    }

    public List<Issue> getByDeliveryStatus(String deliveryStatus) {
        return issueRepository.findByDeliveryStatus(deliveryStatus)
                .stream()
                .filter(doc -> "COMPLETED".equalsIgnoreCase(doc.getCheckStatus()))
                .collect(Collectors.toList());
    }

    // ── Start / Resume delivery ──────────────────────────────────────────
    public Issue startDelivery(Long id) {
        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getDeliveryStatus())) {
            LocalDateTime now = LocalDateTime.now();
            doc.setDeliveryResumeTime(now);

            if (doc.getDeliveryHoldTime() != null) {
                long holdSeconds = Duration.between(doc.getDeliveryHoldTime(), now).getSeconds();
                long existing = doc.getDeliveryTotalHoldSeconds() != null ? doc.getDeliveryTotalHoldSeconds() : 0L;
                doc.setDeliveryTotalHoldSeconds(existing + holdSeconds);
            }
        } else {
            doc.setDeliveryStartTime(LocalDateTime.now());
            doc.setDeliveryTotalHoldSeconds(0L);
        }

        doc.setDeliveryStatus("IN_PROGRESS");
        return issueRepository.save(doc);
    }

    // ── Hold delivery ──────────────────────────────────────────────────────
    public Issue holdDelivery(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);

        doc.setDeliveryStatus("ON_HOLD");
        doc.setDeliveryHoldTime(LocalDateTime.now());
        doc.setDeliveryHoldReason(holdReason);
        doc.setDeliveryHeldBy(heldBy);

        return issueRepository.save(doc);
    }

    // ── End delivery (Delivery Done) ─────────────────────────────────────
    public Issue endDelivery(Long id, String deliveredBy, String vehicleNo) {
        Issue doc = getById(id);

        LocalDateTime endTime = LocalDateTime.now();
        doc.setDeliveryStatus("COMPLETED");
        doc.setDeliveryEndTime(endTime);
        doc.setDeliveredBy(deliveredBy);
        doc.setDeliveryVehicleNo(vehicleNo);

        if (doc.getDeliveryStartTime() != null) {
            long totalElapsed = Duration.between(doc.getDeliveryStartTime(), endTime).getSeconds();
            long holdTime     = doc.getDeliveryTotalHoldSeconds() != null ? doc.getDeliveryTotalHoldSeconds() : 0L;
            long workingTime  = totalElapsed - holdTime;
            doc.setDeliveryDurationSeconds(Math.max(workingTime, 0));
        }

        return issueRepository.save(doc);
    }

    // ── Cancel delivery ───────────────────────────────────────────────────
    public Issue cancelDelivery(Long id, String cancelReason, String cancelledBy) {
        Issue doc = getById(id);

        doc.setDeliveryStatus("CANCELLED");
        doc.setDeliveryCancelReason(cancelReason);
        doc.setDeliveryCancelledBy(cancelledBy);
        doc.setDeliveryCancelTime(LocalDateTime.now());

        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
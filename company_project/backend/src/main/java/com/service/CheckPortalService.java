package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class CheckPortalService {

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

    // hasWrongMaterial is reported at Hold time (per the frontend's HoldPopup),
    // not at End — so the picking-error flag is stamped here.
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
                // A fresh error report always needs a new Emergency Pick —
                // clear any stale resolution from a previous cycle.
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

        // ── Handoff to Delivery Portal ──
        // Delivery Portal filters on checkStatus == COMPLETED, but it also
        // needs a starting point in time to measure its own duration from.
        if (doc.getDeliveryStatus() == null || doc.getDeliveryStatus().isEmpty()) {
            doc.setDeliveryStatus("PENDING");
            doc.setDeliveryStartTime(endTime);
        }

        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
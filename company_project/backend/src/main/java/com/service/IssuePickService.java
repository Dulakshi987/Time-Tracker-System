package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

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
            // doc.setHandoverTime(LocalDateTime.now());

    return issueRepository.save(doc);
}
}
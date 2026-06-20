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

    // ── Get all documents (cart view) ──────────────────────────────────
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

    // ── Start / Resume print ─────────────────────────────────────────────
    // PENDING -> IN_PROGRESS : set startTime
    // ON_HOLD -> IN_PROGRESS : add elapsed hold time to totalHoldSeconds, clear holdTime
    public Issue startPrint(Long id) {
        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getStatus())) {
            // Resuming from hold — accumulate the hold duration
            LocalDateTime now = LocalDateTime.now();
            doc.setResumeTime(now);

            if (doc.getHoldTime() != null) {
                long holdSeconds = Duration.between(doc.getHoldTime(), now).getSeconds();
                long existing = doc.getTotalHoldSeconds() != null ? doc.getTotalHoldSeconds() : 0L;
                doc.setTotalHoldSeconds(existing + holdSeconds);
            }
        } else {
            // First start
            doc.setStartTime(LocalDateTime.now());
            doc.setTotalHoldSeconds(0L);
        }

        doc.setStatus("IN_PROGRESS");
        return issueRepository.save(doc);
    }

    // ── Hold print ────────────────────────────────────────────────────────
    // IN_PROGRESS -> ON_HOLD : record holdTime, holdReason, heldBy
    public Issue holdPrint(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);

        doc.setStatus("ON_HOLD");
        doc.setHoldTime(LocalDateTime.now());
        doc.setHoldReason(holdReason);
        doc.setHeldBy(heldBy);

        return issueRepository.save(doc);
    }

    // ── End print ─────────────────────────────────────────────────────────
    // -> COMPLETED : durationSeconds = (endTime - startTime) - totalHoldSeconds
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

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
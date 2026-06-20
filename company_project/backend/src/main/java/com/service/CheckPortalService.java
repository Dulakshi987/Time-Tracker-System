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

    public List<Issue> getByCheckStatus(String checkStatus) {
        return issueRepository.findByCheckStatus(checkStatus);
    }

    // ── Start / Resume check ─────────────────────────────────────────────
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

    // ── Hold check ────────────────────────────────────────────────────────
    public Issue holdCheck(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);

        doc.setCheckStatus("ON_HOLD");
        doc.setCheckHoldTime(LocalDateTime.now());
        doc.setCheckHoldReason(holdReason);
        doc.setCheckHeldBy(heldBy);

        return issueRepository.save(doc);
    }

    // ── End check (Check Done) ───────────────────────────────────────────
    // hasWrongMaterial: "YES" or "NO"
    // If YES -> wrongMaterialSku + wrongMaterialQty required
    public Issue endCheck(Long id, String checkedBy, String hasWrongMaterial,
                           String wrongMaterialSku, String wrongMaterialQty) {
        Issue doc = getById(id);

        LocalDateTime endTime = LocalDateTime.now();
        doc.setCheckStatus("COMPLETED");
        doc.setCheckEndTime(endTime);
        doc.setCheckedBy(checkedBy);
        doc.setHasWrongMaterial(hasWrongMaterial);

        if ("YES".equalsIgnoreCase(hasWrongMaterial)) {
            doc.setWrongMaterialSku(wrongMaterialSku);
            doc.setWrongMaterialQty(wrongMaterialQty);
        } else {
            doc.setWrongMaterialSku(null);
            doc.setWrongMaterialQty(null);
        }

        if (doc.getCheckStartTime() != null) {
            long totalElapsed = Duration.between(doc.getCheckStartTime(), endTime).getSeconds();
            long holdTime     = doc.getCheckTotalHoldSeconds() != null ? doc.getCheckTotalHoldSeconds() : 0L;
            long workingTime  = totalElapsed - holdTime;
            doc.setCheckDurationSeconds(Math.max(workingTime, 0));
        }

        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class IssuePrintService {

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

    public List<Issue> getByPrintStatus(String printStatus) {
        return issueRepository.findByPrintStatus(printStatus);
    }

    // ── Start / Resume print ─────────────────────────────────────────────
    // PENDING -> IN_PROGRESS : set printStartTime
    // ON_HOLD -> IN_PROGRESS : accumulate hold time
    public Issue startPrint(Long id) {
        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getPrintStatus())) {
            LocalDateTime now = LocalDateTime.now();
            doc.setPrintResumeTime(now);

            if (doc.getPrintHoldTime() != null) {
                long holdSeconds = Duration.between(doc.getPrintHoldTime(), now).getSeconds();
                long existing = doc.getPrintTotalHoldSeconds() != null ? doc.getPrintTotalHoldSeconds() : 0L;
                doc.setPrintTotalHoldSeconds(existing + holdSeconds);
            }
        } else {
            doc.setPrintStartTime(LocalDateTime.now());
            doc.setPrintTotalHoldSeconds(0L);
        }

        doc.setPrintStatus("IN_PROGRESS");
        return issueRepository.save(doc);
    }

    // ── Hold print ────────────────────────────────────────────────────────
    public Issue holdPrint(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);

        doc.setPrintStatus("ON_HOLD");
        doc.setPrintHoldTime(LocalDateTime.now());
        doc.setPrintHoldReason(holdReason);
        doc.setPrintHeldBy(heldBy);

        return issueRepository.save(doc);
    }

    // ── End print (Print Done) ───────────────────────────────────────────
    // Needs: printDocumentNo, printedBy
    // Calculates: printDurationSeconds = totalElapsed - totalHoldSeconds
    public Issue endPrint(Long id, String printDocumentNo, String printedBy) {
        Issue doc = getById(id);

        LocalDateTime endTime = LocalDateTime.now();
        doc.setPrintStatus("COMPLETED");
        doc.setPrintEndTime(endTime);
        doc.setPrintDocumentNo(printDocumentNo);
        doc.setPrintedBy(printedBy);

        if (doc.getPrintStartTime() != null) {
            long totalElapsed = Duration.between(doc.getPrintStartTime(), endTime).getSeconds();
            long holdTime     = doc.getPrintTotalHoldSeconds() != null ? doc.getPrintTotalHoldSeconds() : 0L;
            long workingTime  = totalElapsed - holdTime;
            doc.setPrintDurationSeconds(Math.max(workingTime, 0));
        }

        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class IssuePrintService {

    @Autowired
    private IssueRepository issueRepository;

    public List<Issue> getAllDocuments() {
        return issueRepository.findAll();
    }

    // Date-range filter — pushes filtering to the DB instead of returning
    // every row and letting the frontend filter it.
    public List<Issue> getByDateRange(LocalDate from, LocalDate to) {
        if (from == null && to == null) {
            return issueRepository.findAll();
        }
        LocalDate f = from != null ? from : LocalDate.of(2000, 1, 1);
        LocalDate t = to != null ? to : LocalDate.now();
        return issueRepository.findByRequestDateBetween(f, t);
    }

    // Pagination — plain service method, NOT a REST endpoint.
    // The Controller passes in a Pageable and returns this to the client.
    public Page<Issue> getAllPaged(Pageable pageable) {
        return issueRepository.findAll(pageable);
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

    // ── Step 1: Handover ── PENDING -> HANDED_OVER ──────────────────────
    public Issue handoverPrint(Long id, String handedOverBy) {
        Issue doc = getById(id);
        doc.setPrintHandedOverBy(handedOverBy);
        doc.setPrintHandoverTime(LocalDateTime.now());
        doc.setPrintStatus("HANDED_OVER");
        doc.setPrintTotalHoldSeconds(0L);
        return issueRepository.save(doc);
    }

    // ── Step 2: Start / Resume ───────────────────────────────────────────
    public Issue startPrint(Long id) {
        Issue doc = getById(id);

        if ("ON_HOLD".equals(doc.getPrintStatus())) {
            LocalDateTime now = LocalDateTime.now();
            doc.setPrintResumeTime(now);
            if (doc.getPrintHoldTime() != null) {
                long holdSec = Duration.between(doc.getPrintHoldTime(), now).getSeconds();
                long existing = doc.getPrintTotalHoldSeconds() != null ? doc.getPrintTotalHoldSeconds() : 0L;
                doc.setPrintTotalHoldSeconds(existing + holdSec);
            }
        } else {
            doc.setPrintStartTime(LocalDateTime.now());
            if (doc.getPrintTotalHoldSeconds() == null) {
                doc.setPrintTotalHoldSeconds(0L);
            }
        }

        doc.setPrintStatus("IN_PROGRESS");
        return issueRepository.save(doc);
    }

    // ── Hold ── IN_PROGRESS -> ON_HOLD ───────────────────────────────────
    public Issue holdPrint(Long id, String holdReason, String heldBy) {
        Issue doc = getById(id);
        doc.setPrintStatus("ON_HOLD");
        doc.setPrintHoldTime(LocalDateTime.now());
        doc.setPrintHoldReason(holdReason);
        doc.setPrintHeldBy(heldBy);
        return issueRepository.save(doc);
    }

    // ── End ── IN_PROGRESS / ON_HOLD -> COMPLETED ────────────────────────
    public Issue endPrint(Long id, String printDocumentNo, String printedBy) {
        Issue doc = getById(id);
        LocalDateTime endTime = LocalDateTime.now();
        doc.setPrintStatus("COMPLETED");
        doc.setPrintEndTime(endTime);
        doc.setPrintDocumentNo(printDocumentNo);
        doc.setPrintedBy(printedBy);

        if (doc.getPrintStartTime() != null) {
            long total    = Duration.between(doc.getPrintStartTime(), endTime).getSeconds();
            long holdTime = doc.getPrintTotalHoldSeconds() != null ? doc.getPrintTotalHoldSeconds() : 0L;
            doc.setPrintDurationSeconds(Math.max(total - holdTime, 0));
        }

        return issueRepository.save(doc);
    }

    public void delete(Long id) {
        issueRepository.deleteById(id);
    }
}
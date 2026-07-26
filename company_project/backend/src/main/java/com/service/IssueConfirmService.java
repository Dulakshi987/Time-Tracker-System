package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class IssueConfirmService {

    @Autowired
    private IssueRepository issueRepository;

    // Only delivered / cancelled documents belong on the Confirm Portal.
    // (Hold documents are intentionally excluded — they don't belong here.)
    public List<Issue> getAllConfirmDocuments() {
        return issueRepository.findAll().stream()
                .filter(issue -> isConfirmRelevant(issue.getDeliveryStatus()))
                .collect(Collectors.toList());
    }

    // status param: delivered | cancelled
    public List<Issue> getByConfirmStatus(String status) {
        String normalized = normalize(status);
        return issueRepository.findAll().stream()
                .filter(issue -> normalize(issue.getDeliveryStatus()).equals(normalized))
                .collect(Collectors.toList());
    }

    public Issue getById(Long id) {
        return issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));
    }

    // "Add to File" — stamps the Req ID (computed on the frontend the same way
    // the Print Portal computes it) and saves the user-entered file number.
    // Guarded so the same document can't be filed twice.
    public Issue addToFile(Long id, String reqId, String fileNumber) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        if (issue.getFileNumber() != null && !issue.getFileNumber().isEmpty()) {
            throw new IllegalStateException("Already added to file as " + issue.getFileNumber());
        }

        issue.setReqId(reqId);
        issue.setFileNumber(fileNumber);
        return issueRepository.save(issue);
    }

    // ── NEW: Edit an existing file number ───────────────────────────────
    public Issue editFile(Long id, String newFileNumber) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        if (issue.getFileNumber() == null || issue.getFileNumber().isEmpty()) {
            throw new IllegalStateException("This document has not been added to a file yet");
        }

        issue.setFileNumber(newFileNumber);
        return issueRepository.save(issue);
    }

    // ── NEW: Remove file number (revert document to "not filed") ───────
    public Issue removeFile(Long id) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        issue.setFileNumber(null);
        return issueRepository.save(issue);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    // Hold removed on purpose — only delivered/cancelled qualify now.
    private boolean isConfirmRelevant(String status) {
        if (status == null)
            return false;
        String v = status.toLowerCase();
        return v.contains("cancel") || v.contains("complete") || v.contains("done");
    }

    // Maps raw deliveryStatus text down to one of: delivered | cancelled
    private String normalize(String status) {
        if (status == null)
            return "";
        String v = status.toLowerCase();
        if (v.contains("cancel"))
            return "cancelled";
        if (v.contains("complete") || v.contains("done"))
            return "delivered";
        return v;
    }
}
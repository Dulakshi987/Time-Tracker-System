package com.service;

import com.entity.Issue;
import com.repository.IssueRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class IssueConfirmService {

    @Autowired
    private IssueRepository issueRepository;

    // Only delivered / cancelled documents belong on the Confirm Portal.
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

    // "Add to File"
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

    // Edit an existing file number
    public Issue editFile(Long id, String newFileNumber) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        if (issue.getFileNumber() == null || issue.getFileNumber().isEmpty()) {
            throw new IllegalStateException("This document has not been added to a file yet");
        }

        issue.setFileNumber(newFileNumber);
        return issueRepository.save(issue);
    }

    // Remove file number (revert document to "not filed")
    public Issue removeFile(Long id) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        issue.setFileNumber(null);
        return issueRepository.save(issue);
    }

    // ── NEW: Edit Delivered/Cancelled detail fields ──────────────────────
    // Only touches whichever of these keys are present in `fields`:
    //   deliveredBy, deliveryCancelReason, deliveryCancelledBy
    public Issue editStatusDetails(Long id, Map<String, String> fields) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));

        if (fields.containsKey("deliveredBy")) {
            issue.setDeliveredBy(fields.get("deliveredBy"));
        }
        if (fields.containsKey("deliveryCancelReason")) {
            issue.setDeliveryCancelReason(fields.get("deliveryCancelReason"));
        }
        if (fields.containsKey("deliveryCancelledBy")) {
            issue.setDeliveryCancelledBy(fields.get("deliveryCancelledBy"));
        }

        return issueRepository.save(issue);
    }

    // ── NEW: Permanently delete a document ───────────────────────────────
    public void deleteIssue(Long id) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Issue not found: " + id));
        issueRepository.delete(issue);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private boolean isConfirmRelevant(String status) {
        if (status == null)
            return false;
        String v = status.toLowerCase();
        return v.contains("cancel") || v.contains("complete") || v.contains("done");
    }

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
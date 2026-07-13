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

    // Only delivered / on-hold / cancelled documents belong on the Confirm Portal
    public List<Issue> getAllConfirmDocuments() {
        return issueRepository.findAll().stream()
                .filter(issue -> isConfirmRelevant(issue.getDeliveryStatus()))
                .collect(Collectors.toList());
    }

    // status param: delivered | hold | cancelled
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

    // ── Helpers ──────────────────────────────────────────────────────────

    private boolean isConfirmRelevant(String status) {
        if (status == null)
            return false;
        String v = status.toLowerCase();
        return v.contains("cancel") || v.contains("hold") || v.contains("complete") || v.contains("done");
    }

    // Maps raw deliveryStatus text down to one of: delivered | hold | cancelled
    private String normalize(String status) {
        if (status == null)
            return "";
        String v = status.toLowerCase();
        if (v.contains("cancel"))
            return "cancelled";
        if (v.contains("hold"))
            return "hold";
        if (v.contains("complete") || v.contains("done"))
            return "delivered";
        return v;
    }
}
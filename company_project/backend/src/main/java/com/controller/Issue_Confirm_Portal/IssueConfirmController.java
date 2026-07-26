package com.controller.Issue_Confirm_Portal;

import com.entity.Issue;
import com.service.IssueConfirmService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/issue-confirm")
@CrossOrigin(origins = "http://localhost:5173")
public class IssueConfirmController {

    @Autowired
    private IssueConfirmService issueConfirmService;

    // ── GET all confirm-relevant documents (delivered / cancelled only) ──
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(issueConfirmService.getAllConfirmDocuments());
    }

    // status: delivered | cancelled
    @GetMapping("/status/{status}")
    public ResponseEntity<List<Issue>> getByStatus(@PathVariable String status) {
        return ResponseEntity.ok(issueConfirmService.getByConfirmStatus(status));
    }

    // Used by the "View" side panel to pull full detail for one document
    @GetMapping("/{id}")
    public ResponseEntity<Issue> getById(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issueConfirmService.getById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT Add to File ─────────────────────────────────────────────────
    @PutMapping("/{id}/add-to-file")
    public ResponseEntity<?> addToFile(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String reqId = body.getOrDefault("reqId", "");
        String fileNumber = body.getOrDefault("fileNumber", "");

        if (fileNumber.trim().isEmpty()) {
            return ResponseEntity.badRequest().body("fileNumber is required");
        }

        try {
            return ResponseEntity.ok(issueConfirmService.addToFile(id, reqId, fileNumber.trim()));
        } catch (IllegalStateException alreadyFiled) {
            return ResponseEntity.status(409).body(alreadyFiled.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT Edit File Number ────────────────────────────────────────────
    @PutMapping("/{id}/edit-file")
    public ResponseEntity<?> editFile(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String fileNumber = body.getOrDefault("fileNumber", "");

        if (fileNumber.trim().isEmpty()) {
            return ResponseEntity.badRequest().body("fileNumber is required");
        }

        try {
            return ResponseEntity.ok(issueConfirmService.editFile(id, fileNumber.trim()));
        } catch (IllegalStateException notFiled) {
            return ResponseEntity.status(409).body(notFiled.getMessage());
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── DELETE File Number (revert to "not filed", document stays) ──────
    @DeleteMapping("/{id}/file")
    public ResponseEntity<?> deleteFile(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issueConfirmService.removeFile(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── NEW: PUT Edit Status details ─────────────────────────────────────
    // Used when the Delivered / Cancelled badge is clicked and edited.
    // body may include any of: deliveredBy, deliveryCancelReason, deliveryCancelledBy
    // Only the fields present in the body are updated.
    @PutMapping("/{id}/edit-status")
    public ResponseEntity<?> editStatus(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(issueConfirmService.editStatusDetails(id, body));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── NEW: DELETE the whole document ───────────────────────────────────
    // Used by the Delivered / Cancelled badge's Delete option. Permanently
    // removes the document from the system (not just the file number).
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteDocument(@PathVariable Long id) {
        try {
            issueConfirmService.deleteIssue(id);
            return ResponseEntity.ok().build();
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
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
    // body: { reqId, fileNumber } — fileNumber is now entered by the user via
    // the "Add to File" popup on the frontend, not auto-generated on the server.
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
    // body: { fileNumber } — only allowed once the document already has a
    // file number (i.e. it was already added to file).
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

    // ── DELETE File Number ──────────────────────────────────────────────
    // Clears the file number/reqId, sending the document back to "not filed".
    // Does NOT delete the underlying Issue/document itself.
    @DeleteMapping("/{id}/file")
    public ResponseEntity<?> deleteFile(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issueConfirmService.removeFile(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
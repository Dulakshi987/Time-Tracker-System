package com.controller.Issue_Print_Portal;

import com.entity.Issue;
import com.service.IssuePrintService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/print-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class IssuePrintController {

    @Autowired
    private IssuePrintService issuePrintService;

    // ── GET all documents (cart view) ──────────────────────────────────
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(issuePrintService.getAllDocuments());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Issue> getById(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issuePrintService.getById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/type/{jobType}")
    public ResponseEntity<List<Issue>> getByJobType(@PathVariable String jobType) {
        return ResponseEntity.ok(issuePrintService.getByJobType(jobType));
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<Issue>> getByPrintStatus(@PathVariable String status) {
        return ResponseEntity.ok(issuePrintService.getByPrintStatus(status));
    }

    // ── PUT Start / Resume ───────────────────────────────────────────────
    @PutMapping("/{id}/start")
    public ResponseEntity<Issue> start(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issuePrintService.startPrint(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT Hold ───────────────────────────────────────────────────────
    @PutMapping("/{id}/hold")
    public ResponseEntity<Issue> hold(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String holdReason = body.getOrDefault("holdReason", "");
        String heldBy     = body.getOrDefault("heldBy", "");

        try {
            return ResponseEntity.ok(issuePrintService.holdPrint(id, holdReason, heldBy));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT End (Print Done) ─────────────────────────────────────────────
    // body: { printDocumentNo, printedBy }
    @PutMapping("/{id}/end")
    public ResponseEntity<Issue> end(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String printDocumentNo = body.getOrDefault("printDocumentNo", "");
        String printedBy       = body.getOrDefault("printedBy", "");

        try {
            return ResponseEntity.ok(issuePrintService.endPrint(id, printDocumentNo, printedBy));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        issuePrintService.delete(id);
        return ResponseEntity.noContent().build();
    }
} 

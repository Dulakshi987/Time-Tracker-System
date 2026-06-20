package com.controller.Issue_Print_Portal;

import com.entity.Issue;
import com.service.IssuePickService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/pick-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class IssuePickController {

    @Autowired
    private IssuePickService issuePrintService;

    // ── GET all documents (cart view) ──────────────────────────────────
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(issuePrintService.getAllDocuments());
    }

    // ── GET by id ──────────────────────────────────────────────────────
    @GetMapping("/{id}")
    public ResponseEntity<Issue> getById(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issuePrintService.getById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── GET by job type ────────────────────────────────────────────────
    @GetMapping("/type/{jobType}")
    public ResponseEntity<List<Issue>> getByJobType(@PathVariable String jobType) {
        return ResponseEntity.ok(issuePrintService.getByJobType(jobType));
    }

    // ── GET by status ──────────────────────────────────────────────────
    @GetMapping("/status/{status}")
    public ResponseEntity<List<Issue>> getByStatus(@PathVariable String status) {
        return ResponseEntity.ok(issuePrintService.getByStatus(status));
    }

    // ── PUT Start / Resume ───────────────────────────────────────────────
    // PENDING -> IN_PROGRESS (first start)
    // ON_HOLD -> IN_PROGRESS (resume)
    @PutMapping("/{id}/start")
    public ResponseEntity<Issue> start(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issuePrintService.startPrint(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT Hold ───────────────────────────────────────────────────────
    // IN_PROGRESS -> ON_HOLD, needs holdReason + heldBy
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

    // ── PUT End ────────────────────────────────────────────────────────
    // -> COMPLETED, needs pickedBy
    @PutMapping("/{id}/end")
    public ResponseEntity<Issue> end(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String pickedBy = body.getOrDefault("pickedBy", "");

        try {
            return ResponseEntity.ok(issuePrintService.endPrint(id, pickedBy));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── DELETE (optional) ─────────────────────────────────────────────
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        issuePrintService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
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

    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(issuePrintService.getAllDocuments());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Issue> getById(@PathVariable Long id) {
        try { return ResponseEntity.ok(issuePrintService.getById(id)); }
        catch (RuntimeException e) { return ResponseEntity.notFound().build(); }
    }

    @GetMapping("/type/{jobType}")
    public ResponseEntity<List<Issue>> getByJobType(@PathVariable String jobType) {
        return ResponseEntity.ok(issuePrintService.getByJobType(jobType));
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<Issue>> getByPrintStatus(@PathVariable String status) {
        return ResponseEntity.ok(issuePrintService.getByPrintStatus(status));
    }

    // Step 1: Handover — records who handed the document over
    @PutMapping("/{id}/handover")
    public ResponseEntity<Issue> handover(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(issuePrintService.handoverPrint(
                id, body.getOrDefault("handedOverBy", "")
            ));
        } catch (RuntimeException e) { return ResponseEntity.notFound().build(); }
    }

    // Step 2: Start / Resume — no body needed, name was captured at Handover
    @PutMapping("/{id}/start")
    public ResponseEntity<Issue> start(@PathVariable Long id) {
        try { return ResponseEntity.ok(issuePrintService.startPrint(id)); }
        catch (RuntimeException e) { return ResponseEntity.notFound().build(); }
    }

    @PutMapping("/{id}/hold")
    public ResponseEntity<Issue> hold(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(issuePrintService.holdPrint(
                id,
                body.getOrDefault("holdReason", ""),
                body.getOrDefault("heldBy", "")
            ));
        } catch (RuntimeException e) { return ResponseEntity.notFound().build(); }
    }

    @PutMapping("/{id}/end")
    public ResponseEntity<Issue> end(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(issuePrintService.endPrint(
                id,
                body.getOrDefault("printDocumentNo", ""),
                body.getOrDefault("printedBy", "")
            ));
        } catch (RuntimeException e) { return ResponseEntity.notFound().build(); }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        issuePrintService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
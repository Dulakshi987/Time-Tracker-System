package com.controller.Issue_Print_Portal;

import com.dto.IssuePrintPageResponse;
import com.entity.Issue;
import com.service.IssuePrintService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
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
    public ResponseEntity<List<Issue>> getAll(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        return ResponseEntity.ok(issuePrintService.getByDateRange(from, to));
    }

    @GetMapping("/paged")
    public ResponseEntity<Page<Issue>> getAllPaged(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        Pageable pageable = PageRequest.of(page, size);
        return ResponseEntity.ok(issuePrintService.getAllPaged(pageable));
    }

    // ── New: filtered + paginated search, used by the Print Portal UI ──
    @GetMapping("/search")
    public ResponseEntity<IssuePrintPageResponse> search(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String jobType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String divisions,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "24") int size) {
        return ResponseEntity.ok(
            issuePrintService.search(from, to, jobType, status, search, divisions, page, size)
        );
    }

    // ── New: document numbers already used, for duplicate check across
    //          ALL documents (not just the currently loaded page) ──────
    @GetMapping("/used-document-numbers")
    public ResponseEntity<List<String>> usedDocumentNumbers(
            @RequestParam(required = false) Long excludeId) {
        return ResponseEntity.ok(issuePrintService.getUsedDocumentNumbers(excludeId));
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
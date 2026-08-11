package com.controller.Issue_Print_Portal;

import com.entity.Issue;
import com.service.IssuePrintService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/print-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class IssuePrintController {

    @Autowired
    private IssuePrintService issuePrintService;

    // Paginated + filtered list — this is what the portal grid uses now
    @GetMapping
    public ResponseEntity<Page<Issue>> getAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String jobType,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(
                issuePrintService.getPaginated(page, size, status, jobType, search, fromDate, toDate)
        );
    }

    // Stat chip counts — cheap DB counts, independent of pagination
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Long>> getStats(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(issuePrintService.getStats(fromDate, toDate));
    }

    // Kept for anything that still needs the unpaginated full list (e.g. exports)
    @GetMapping("/all")
    public ResponseEntity<List<Issue>> getAllUnpaged() {
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
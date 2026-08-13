package com.controller.Issue_Print_Portal;

import com.entity.Issue;
import com.service.IssuePickService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/pick-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class PickPortalController {

    @Autowired
    private IssuePickService issuePickService;

    // Kept for anything still relying on the full unpaginated list
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(issuePickService.getAllDocuments());
    }

    // ── Paginated + filtered list — this is what the frontend grid should call ──
    @GetMapping("/paged")
    public ResponseEntity<Page<Issue>> getPaged(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String jobType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String divisions // comma-separated divisionNo list, omit for "all"
    ) {
        return ResponseEntity.ok(
                issuePickService.getDocumentsPaged(page, size, jobType, status, search, date, divisions)
        );
    }

    // ── Stat chip counts — computed in the DB, independent of page size ──
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Long>> getStats(
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String divisions
    ) {
        return ResponseEntity.ok(issuePickService.getStats(date, divisions));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Issue> getById(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issuePickService.getById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/type/{jobType}")
    public ResponseEntity<List<Issue>> getByJobType(@PathVariable String jobType) {
        return ResponseEntity.ok(issuePickService.getByJobType(jobType));
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<Issue>> getByStatus(@PathVariable String status) {
        return ResponseEntity.ok(issuePickService.getByStatus(status));
    }

    @PutMapping("/{id}/start")
    public ResponseEntity<Issue> start(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issuePickService.startPrint(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PutMapping("/{id}/hold")
    public ResponseEntity<Issue> hold(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(issuePickService.holdPrint(
                id,
                body.getOrDefault("holdReason", ""),
                body.getOrDefault("heldBy", "")
            ));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PutMapping("/{id}/end")
    public ResponseEntity<Issue> end(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(issuePickService.endPrint(
                id, body.getOrDefault("pickedBy", "")
            ));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PutMapping("/{id}/emergency-resolve")
    public ResponseEntity<Issue> emergencyResolve(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(issuePickService.emergencyResolve(
                id, body.getOrDefault("resolvedBy", "")
            ));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        issuePickService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{id}/handover")
    public ResponseEntity<Issue> handover(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(issuePickService.handoverPrint(
                id, body.getOrDefault("handedOverBy", "")
            ));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
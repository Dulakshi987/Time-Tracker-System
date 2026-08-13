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

    // ─────────────────────────────────────────────────────────────────────
    // Get all documents
    // Kept for backward compatibility
    // ─────────────────────────────────────────────────────────────────────
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(issuePickService.getAllDocuments());
    }

    // ─────────────────────────────────────────────────────────────────────
    // Paginated + filtered documents
    // Frontend Pick Portal grid uses this endpoint
    // ─────────────────────────────────────────────────────────────────────
    @GetMapping("/paged")
    public ResponseEntity<Page<Issue>> getPaged(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String jobType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String divisions
    ) {
        return ResponseEntity.ok(
                issuePickService.getDocumentsPaged(
                        page,
                        size,
                        jobType,
                        status,
                        search,
                        date,
                        divisions
                )
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // ALL JOB TYPES
    //
    // Important:
    // This returns all available Job Types from the database instead of
    // taking Job Types only from the current 25-row page.
    //
    // If divisions are supplied, only Job Types belonging to the user's
    // allowed divisions are returned.
    // ─────────────────────────────────────────────────────────────────────
    @GetMapping("/job-types")
    public ResponseEntity<List<String>> getJobTypes(
            @RequestParam(required = false) String divisions
    ) {
        return ResponseEntity.ok(
                issuePickService.getAllJobTypes(divisions)
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Statistics
    // Counts are calculated in the database
    // ─────────────────────────────────────────────────────────────────────
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Long>> getStats(
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String divisions
    ) {
        return ResponseEntity.ok(
                issuePickService.getStats(date, divisions)
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Get document by ID
    // ─────────────────────────────────────────────────────────────────────
    @GetMapping("/{id}")
    public ResponseEntity<Issue> getById(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issuePickService.getById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Get documents by Job Type
    // ─────────────────────────────────────────────────────────────────────
    @GetMapping("/type/{jobType}")
    public ResponseEntity<List<Issue>> getByJobType(
            @PathVariable String jobType
    ) {
        return ResponseEntity.ok(
                issuePickService.getByJobType(jobType)
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Get documents by Status
    // ─────────────────────────────────────────────────────────────────────
    @GetMapping("/status/{status}")
    public ResponseEntity<List<Issue>> getByStatus(
            @PathVariable String status
    ) {
        return ResponseEntity.ok(
                issuePickService.getByStatus(status)
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Start / Resume
    // ─────────────────────────────────────────────────────────────────────
    @PutMapping("/{id}/start")
    public ResponseEntity<Issue> start(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(
                    issuePickService.startPrint(id)
            );
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Hold
    // ─────────────────────────────────────────────────────────────────────
    @PutMapping("/{id}/hold")
    public ResponseEntity<Issue> hold(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        try {
            return ResponseEntity.ok(
                    issuePickService.holdPrint(
                            id,
                            body.getOrDefault("holdReason", ""),
                            body.getOrDefault("heldBy", "")
                    )
            );
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pick Done / End
    // ─────────────────────────────────────────────────────────────────────
    @PutMapping("/{id}/end")
    public ResponseEntity<Issue> end(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        try {
            return ResponseEntity.ok(
                    issuePickService.endPrint(
                            id,
                            body.getOrDefault("pickedBy", "")
                    )
            );
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Emergency Pick Done
    // ─────────────────────────────────────────────────────────────────────
    @PutMapping("/{id}/emergency-resolve")
    public ResponseEntity<Issue> emergencyResolve(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        try {
            return ResponseEntity.ok(
                    issuePickService.emergencyResolve(
                            id,
                            body.getOrDefault("resolvedBy", "")
                    )
            );
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Delete
    // ─────────────────────────────────────────────────────────────────────
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        issuePickService.delete(id);
        return ResponseEntity.noContent().build();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Handover
    // ─────────────────────────────────────────────────────────────────────
    @PutMapping("/{id}/handover")
    public ResponseEntity<Issue> handover(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        try {
            return ResponseEntity.ok(
                    issuePickService.handoverPrint(
                            id,
                            body.getOrDefault("handedOverBy", "")
                    )
            );
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
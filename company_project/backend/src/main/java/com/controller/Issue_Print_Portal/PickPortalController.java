package com.controller.Issue_Print_Portal;

import com.dto.IssuePrintPageResponse;
import com.entity.Issue;
import com.service.IssuePickService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/pick-portal")
@CrossOrigin(origins = {"http://localhost:5173", "https://logitrack-warehouse-system.netlify.app"})
public class PickPortalController {

    @Autowired
    private IssuePickService issuePickService;

    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(issuePickService.getAllDocuments());
    }

    // ── New: filtered + paginated search, used by the Pick Portal UI ──
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
            issuePickService.search(from, to, jobType, status, search, divisions, page, size)
        );
    }

    // ── New: full distinct job-type list, independent of pagination ──
    @GetMapping("/job-types")
    public ResponseEntity<List<String>> jobTypes() {
        return ResponseEntity.ok(issuePickService.getDistinctJobTypes());
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
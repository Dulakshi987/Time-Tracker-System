package com.controller.Issue_Print_Portal;

import com.entity.Issue;
import com.service.IssuePickService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

// ⚠ This controller did not exist before — /api/pick-portal was 404ing,
// which is why documents could never move past Print (Pick Portal page
// couldn't even load), and every downstream stat (Pick/Check/Delivery)
// stayed empty.
@RestController
@RequestMapping("/api/pick-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class PickPortalController {

    @Autowired
    private IssuePickService issuePickService;

    // Frontend filters client-side for printDocumentNo != null, so we
    // return everything here — same pattern as Print/Check controllers.
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(issuePickService.getAllDocuments());
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

    // Start / Resume — no body needed
    @PutMapping("/{id}/start")
    public ResponseEntity<Issue> start(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(issuePickService.startPrint(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // body: { holdReason, heldBy }
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

    // body: { pickedBy }
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

    // body: { resolvedBy } — resolves a wrong-material flag raised by Check
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

    // body: { handedOverBy }
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
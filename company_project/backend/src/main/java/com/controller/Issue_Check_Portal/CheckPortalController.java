package com.controller.Issue_Check_Portal;

import com.entity.Issue;
import com.service.CheckPortalService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import com.dto.IssuePrintPageResponse;


@RestController
@RequestMapping("/api/check-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class CheckPortalController {

    @Autowired
    private CheckPortalService checkPortalService;

    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(checkPortalService.getAllDocuments());
    }

    // ── Optional paginated endpoint ──────────────────────────────────
    // GET /api/check-portal/paged?page=0&size=10
    // Not wired into the Check Portal UI right now (the grid there filters
    // client-side on the full list from GET /api/check-portal above, so
    // paging there is also done client-side — see IssueCheckForm.jsx).
    // This is here in case a true server-side paginated view is needed
    // later (e.g. a "load more" list without the search/filter toolbar).

    @GetMapping("/search")
    public ResponseEntity<IssuePrintPageResponse> search(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String jobType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String divisions,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ResponseEntity.ok(
            checkPortalService.search(from, to, jobType, status, search, divisions, page, size)
        );
    }

    @GetMapping("/alerts")
    public ResponseEntity<List<Issue>> alerts(@RequestParam(required = false) String divisions) {
        return ResponseEntity.ok(checkPortalService.getPickingErrorAlerts(divisions));
    }

    @GetMapping("/job-types")
    public ResponseEntity<List<String>> jobTypes() {
        return ResponseEntity.ok(checkPortalService.getDistinctJobTypes());
    }

    @GetMapping("/paged")
    public ResponseEntity<Page<Issue>> getAllPaged(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ResponseEntity.ok(checkPortalService.getDocumentsPaged(page, size));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Issue> getById(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(checkPortalService.getById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/type/{jobType}")
    public ResponseEntity<List<Issue>> getByJobType(@PathVariable String jobType) {
        return ResponseEntity.ok(checkPortalService.getByJobType(jobType));
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<Issue>> getByCheckStatus(@PathVariable String status) {
        return ResponseEntity.ok(checkPortalService.getByCheckStatus(status));
    }

    @PutMapping("/{id}/start")
    public ResponseEntity<Issue> start(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(checkPortalService.startCheck(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT Hold ── body: { holdReason, heldBy, hasWrongMaterial: "YES"/"NO", wrongMaterialSku, wrongMaterialQty }
    @PutMapping("/{id}/hold")
    public ResponseEntity<Issue> hold(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String holdReason       = body.getOrDefault("holdReason", "");
        String heldBy           = body.getOrDefault("heldBy", "");
        String hasWrongMaterial = body.get("hasWrongMaterial");
        String wrongMaterialSku = body.getOrDefault("wrongMaterialSku", "");
        String wrongMaterialQty = body.getOrDefault("wrongMaterialQty", "");

        try {
            return ResponseEntity.ok(
                checkPortalService.holdCheck(id, holdReason, heldBy, hasWrongMaterial, wrongMaterialSku, wrongMaterialQty)
            );
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT End (Check Done) ── body: { checkedBy }
    @PutMapping("/{id}/end")
    public ResponseEntity<Issue> end(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String checkedBy = body.getOrDefault("checkedBy", "");

        try {
            return ResponseEntity.ok(checkPortalService.endCheck(id, checkedBy));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PutMapping("/{id}/edit")
    public Issue editCheck(@PathVariable Long id, @RequestBody Map<String, String> body) {
        return checkPortalService.editCheck(id, body.get("heldBy"), body.get("checkedBy"));
    }

    @DeleteMapping("/{id}")
    public void deleteCheck(@PathVariable Long id) {
        checkPortalService.delete(id);
    }
}
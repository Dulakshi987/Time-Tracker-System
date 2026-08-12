package com.controller.Issue_Check_Portal;

import com.entity.Issue;
import com.service.CheckPortalService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/check-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class CheckPortalController {

    @Autowired
    private CheckPortalService checkPortalService;

    // Kept for anything still relying on the full unpaginated list
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(checkPortalService.getAllDocuments());
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
                checkPortalService.getDocumentsPaged(page, size, jobType, status, search, date, divisions)
        );
    }

    // ── Stat chip counts — computed in the DB, independent of page size ──
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Long>> getStats(
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String divisions
    ) {
        return ResponseEntity.ok(checkPortalService.getStats(date, divisions));
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

    // body: { holdReason, heldBy, hasWrongMaterial: "YES"/"NO", wrongMaterialSku, wrongMaterialQty }
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

    // body: { checkedBy }
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
    public ResponseEntity<Issue> editCheck(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(checkPortalService.editCheck(id, body.get("heldBy"), body.get("checkedBy")));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCheck(@PathVariable Long id) {
        checkPortalService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
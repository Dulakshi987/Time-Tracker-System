package com.controller.Issue_Delivery_Portal;

import com.entity.Issue;
import com.service.DeliveryPortalService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/delivery-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class DeliveryPortalController {

    @Autowired
    private DeliveryPortalService deliveryPortalService;

    // ── GET all documents (only Check Done items) ───────────────────────
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(deliveryPortalService.getAllDocuments());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Issue> getById(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(deliveryPortalService.getById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/type/{jobType}")
    public ResponseEntity<List<Issue>> getByJobType(@PathVariable String jobType) {
        return ResponseEntity.ok(deliveryPortalService.getByJobType(jobType));
    }

    @GetMapping("/status/{status}")
    public ResponseEntity<List<Issue>> getByDeliveryStatus(@PathVariable String status) {
        return ResponseEntity.ok(deliveryPortalService.getByDeliveryStatus(status));
    }

    // ── PUT Hold ───────────────────────────────────────────────────────
    @PutMapping("/{id}/hold")
    public ResponseEntity<Issue> hold(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String holdReason = body.getOrDefault("holdReason", "");
        String heldBy     = body.getOrDefault("heldBy", "");

        try {
            return ResponseEntity.ok(deliveryPortalService.holdDelivery(id, holdReason, heldBy));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT End (Delivery Done) ──────────────────────────────────────────
    @PutMapping("/{id}/end")
    public ResponseEntity<Issue> end(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String deliveredBy = body.getOrDefault("deliveredBy", "");
        String vehicleNo   = body.getOrDefault("vehicleNo", "");

        try {
            return ResponseEntity.ok(deliveryPortalService.endDelivery(id, deliveredBy, vehicleNo));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ── PUT Cancel ─────────────────────────────────────────────────────
    @PutMapping("/{id}/cancel")
    public ResponseEntity<Issue> cancel(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {

        String cancelReason = body.getOrDefault("cancelReason", "");
        String cancelledBy  = body.getOrDefault("cancelledBy", "");

        try {
            return ResponseEntity.ok(deliveryPortalService.cancelDelivery(id, cancelReason, cancelledBy));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        deliveryPortalService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
package com.controller.Issue_Delivery_Portal;

import com.entity.Issue;
import com.service.DeliveryPortalService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

// ⚠ This controller + its service did not exist at all before.
// /api/delivery-portal was 404ing — Delivery Portal page and Issue Confirm
// Portal (which reads from the same endpoint) could never load real data.
@RestController
@RequestMapping("/api/delivery-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class DeliveryPortalController {

    @Autowired
    private DeliveryPortalService deliveryPortalService;

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
    public ResponseEntity<List<Issue>> getByStatus(@PathVariable String status) {
        return ResponseEntity.ok(deliveryPortalService.getByDeliveryStatus(status));
    }

    // body: { holdReason, heldBy }
    @PutMapping("/{id}/hold")
    public ResponseEntity<Issue> hold(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(deliveryPortalService.holdDelivery(
                    id, body.getOrDefault("holdReason", ""), body.getOrDefault("heldBy", "")));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // body: { deliveredBy, vehicleNo }
    @PutMapping("/{id}/end")
    public ResponseEntity<Issue> end(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(deliveryPortalService.endDelivery(
                    id, body.getOrDefault("deliveredBy", ""), body.getOrDefault("vehicleNo", "")));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // body: { cancelReason, cancelledBy }
    @PutMapping("/{id}/cancel")
    public ResponseEntity<Issue> cancel(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(deliveryPortalService.cancelDelivery(
                    id, body.getOrDefault("cancelReason", ""), body.getOrDefault("cancelledBy", "")));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // body: { vehicleNo } — the *request* vehicle number
    @PutMapping("/{id}/vehicle")
    public ResponseEntity<Issue> updateVehicle(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(deliveryPortalService.updateVehicleNo(
                    id, body.getOrDefault("vehicleNo", "")));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // body: { deliveryVehicleNo } — the *delivery-time* vehicle number
    @PutMapping("/{id}/delivery-vehicle")
    public ResponseEntity<Issue> updateDeliveryVehicle(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(deliveryPortalService.updateDeliveryVehicleNo(
                    id, body.getOrDefault("deliveryVehicleNo", "")));
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
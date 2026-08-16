package com.controller.Issue_Delivery_Portal;

import com.dto.IssueDeliveryPageResponse;
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

    // Kept as-is for backward compatibility — Issue Confirm Portal (and
    // anything else already wired to the plain list) still reads this.
    // The Delivery Portal UI itself has moved to /paged below so it no
    // longer downloads every Check-Done document on every load/action.
    @GetMapping
    public ResponseEntity<List<Issue>> getAll() {
        return ResponseEntity.ok(deliveryPortalService.getAllDocuments());
    }

    // Paginated + filtered read for the Delivery Portal table. All filtering
    // (search / job type / status / division / date range / stat chip) and
    // the division-access restriction for non-admin logins happen here on
    // the server, so only the current page of matching rows is ever sent
    // to the browser — this is what actually cuts data usage.
    //
    // allowedDivisions: comma-separated divisionNo list. The frontend
    // leaves this empty for Admin / System Administrator and fills it with
    // the caller's own assigned division(s) for every other login.
    @GetMapping("/paged")
    public ResponseEntity<IssueDeliveryPageResponse> getPaged(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String jobType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String divisionNo,
            @RequestParam(required = false) String allowedDivisions,
            @RequestParam(defaultValue = "TODAY") String dateMode,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @RequestParam(required = false) String statFilter
    ) {
        return ResponseEntity.ok(deliveryPortalService.getPagedDeliveryDocuments(
                page, size, search, jobType, status, divisionNo, allowedDivisions,
                dateMode, fromDate, toDate, statFilter));
    }

    // Distinct Job Type values only — a few bytes — so the "Job Type"
    // filter dropdown stays accurate without shipping every document.
    @GetMapping("/filters")
    public ResponseEntity<List<String>> getFilterOptions() {
        return ResponseEntity.ok(deliveryPortalService.getFilterOptions());
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

    // body: { handoverBy }
    // Only meaningful while the row is On Hold or Cancelled — the frontend
    // enforces this by disabling the button otherwise.
    @PutMapping("/{id}/handover")
    public ResponseEntity<Issue> handover(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(deliveryPortalService.handoverDelivery(
                    id, body.getOrDefault("handoverBy", "")));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // No body required — clears the handover stamp and resets deliveryStatus
    // back to PENDING so Delivered / Hold / Cancel unlock again on the UI.
    @PutMapping("/{id}/reactivate")
    public ResponseEntity<Issue> reactivate(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(deliveryPortalService.reactivateDelivery(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // body: { heldBy, cancelledBy, deliveredBy } — any of these may be omitted/null
    @PutMapping("/{id}/edit")
    public ResponseEntity<Issue> edit(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(deliveryPortalService.editDelivery(
                    id, body.get("heldBy"), body.get("cancelledBy"), body.get("deliveredBy")));
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
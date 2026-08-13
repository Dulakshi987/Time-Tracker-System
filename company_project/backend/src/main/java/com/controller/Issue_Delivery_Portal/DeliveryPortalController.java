package com.controller.Issue_Delivery_Portal;

import com.entity.Issue;
import com.service.DeliveryPortalService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/delivery-portal")
@CrossOrigin(origins = "http://localhost:5173")
public class DeliveryPortalController {

    @Autowired
    private DeliveryPortalService deliveryPortalService;

    // Paginated + filtered list — this is what the Delivery Portal table calls now.
    // GET /api/delivery-portal?page=0&size=25&search=&jobType=ALL&status=ALL
    //     &statClass=ALL&divisionNo=ALL&divisions=D01,D02&dateMode=TODAY&fromDate=&toDate=
    @GetMapping
    public ResponseEntity<Page<Issue>> getAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false, defaultValue = "ALL") String jobType,
            @RequestParam(required = false, defaultValue = "ALL") String status,
            @RequestParam(required = false, defaultValue = "ALL") String statClass,
            @RequestParam(required = false, defaultValue = "ALL") String divisionNo,
            @RequestParam(required = false) String divisions, // comma-separated — non-admin division scope
            @RequestParam(required = false, defaultValue = "TODAY") String dateMode,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate) {

        List<String> allowed = splitOrNull(divisions);

        return ResponseEntity.ok(deliveryPortalService.getDocuments(
                page, size, search, jobType, status, statClass, divisionNo, allowed, dateMode, fromDate, toDate));
    }

    // Counts only — powers the stat chips + overdue banner without shipping full rows.
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats(
            @RequestParam(required = false, defaultValue = "ALL") String divisionNo,
            @RequestParam(required = false) String divisions,
            @RequestParam(required = false, defaultValue = "TODAY") String dateMode,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate) {

        List<String> allowed = splitOrNull(divisions);

        return ResponseEntity.ok(deliveryPortalService.getStats(divisionNo, allowed, dateMode, fromDate, toDate));
    }

    // Req ID numbering map (id -> "20260816/0001") — small payload.
    @GetMapping("/numbering")
    public ResponseEntity<Map<Long, String>> getNumbering(
            @RequestParam(required = false, defaultValue = "ALL") String divisionNo,
            @RequestParam(required = false) String divisions) {

        List<String> allowed = splitOrNull(divisions);

        return ResponseEntity.ok(deliveryPortalService.getRequestIdNumbering(divisionNo, allowed));
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
    @PutMapping("/{id}/handover")
    public ResponseEntity<Issue> handover(@PathVariable Long id, @RequestBody Map<String, String> body) {
        try {
            return ResponseEntity.ok(deliveryPortalService.handoverDelivery(
                    id, body.getOrDefault("handoverBy", "")));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

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

    private List<String> splitOrNull(String csv) {
        return (csv == null || csv.isBlank()) ? null : Arrays.asList(csv.split(","));
    }
}
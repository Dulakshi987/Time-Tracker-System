package com.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Entity
@Table(name = "document")
@Data
public class Issue {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // ── who requested this document (shown under Request Date/Time) ──
    @Column(name = "requested_by")
    private String requestedBy;

    // ── vehicle number for the request (shown under Requested By) ──
    @Column(name = "vehicle_no")
    private String vehicleNo;

    
    // ── optional — new field ──
    @Column(name = "sap_issue_line_no")
    private String sapIssueLineNo;

    @Column(name = "print_handover_time")
    private LocalDateTime printHandoverTime;

    @Column(name = "customer_name")
    private String customerName;

    @Column(name = "entered_by")
    private String enteredBy;

    @Column(name = "job_type")
    private String jobType;

    @Column(name = "jobwbs")
    private String jobwbs;

    @Column(name = "request_date")
    private String requestDate;

    @Column(name = "request_time")
    private String requestTime;

    private String reservationNo;

    @Column(name = "status")
    private String status;

    @Column(name = "created_datetime")
    private LocalDateTime createdDatetime;

    // ── Print Portal tracking fields ──
    @Column(name = "start_time")
    private LocalDateTime startTime;

    @Column(name = "end_time")
    private LocalDateTime endTime;

    @Column(name = "duration_seconds")
    private Long durationSeconds;

    @Column(name = "picked_by")
    private String pickedBy;

    // ── Hold tracking fields ──
    @Column(name = "hold_time")
    private LocalDateTime holdTime;

    @Column(name = "resume_time")
    private LocalDateTime resumeTime;

    @Column(name = "hold_reason")
    private String holdReason;

    @Column(name = "held_by")
    private String heldBy;

    @Column(name = "total_hold_seconds")
    private Long totalHoldSeconds;

    // ── Print Portal specific fields ─────────────────────────────────
    @Column(name = "print_status")
    private String printStatus;

    @Column(name = "print_start_time")
    private LocalDateTime printStartTime;

    @Column(name = "print_end_time")
    private LocalDateTime printEndTime;

    @Column(name = "print_hold_time")
    private LocalDateTime printHoldTime;

    @Column(name = "print_resume_time")
    private LocalDateTime printResumeTime;

    @Column(name = "print_hold_reason")
    private String printHoldReason;

    @Column(name = "print_held_by")
    private String printHeldBy;

    @Column(name = "print_total_hold_seconds")
    private Long printTotalHoldSeconds;

    @Column(name = "print_duration_seconds")
    private Long printDurationSeconds;

    @Column(name = "printed_by")
    private String printedBy;

    @Column(name = "print_document_no")
    private String printDocumentNo;

    // ── Check Portal fields ─────────────────────────────────────────
    @Column(name = "check_status")
    private String checkStatus;

    @Column(name = "check_start_time")
    private LocalDateTime checkStartTime;

    @Column(name = "check_end_time")
    private LocalDateTime checkEndTime;

    @Column(name = "check_hold_time")
    private LocalDateTime checkHoldTime;

    @Column(name = "check_resume_time")
    private LocalDateTime checkResumeTime;

    @Column(name = "check_hold_reason")
    private String checkHoldReason;

    @Column(name = "check_held_by")
    private String checkHeldBy;

    @Column(name = "check_total_hold_seconds")
    private Long checkTotalHoldSeconds;

    @Column(name = "check_duration_seconds")
    private Long checkDurationSeconds;

    @Column(name = "checked_by")
    private String checkedBy;

    @Column(name = "has_wrong_material")
    private String hasWrongMaterial;

    @Column(name = "wrong_material_sku")
    private String wrongMaterialSku;

    @Column(name = "wrong_material_qty")
    private String wrongMaterialQty;

    // ── Emergency Pick fields (Check ↔ Pick coordination) ─────────────
    @Column(name = "emergency_pick_resolved")
    private Boolean emergencyPickResolved;

    @Column(name = "emergency_pick_resolved_by")
    private String emergencyPickResolvedBy;

    @Column(name = "emergency_resolved_time")
    private LocalDateTime emergencyResolvedTime;

    // ── Delivery Portal fields ────────────────────────────────────────
    @Column(name = "delivery_status")
    private String deliveryStatus;

    @Column(name = "delivery_start_time")
    private LocalDateTime deliveryStartTime;

    @Column(name = "delivery_end_time")
    private LocalDateTime deliveryEndTime;

    @Column(name = "delivery_hold_time")
    private LocalDateTime deliveryHoldTime;

    @Column(name = "delivery_resume_time")
    private LocalDateTime deliveryResumeTime;

    @Column(name = "delivery_hold_reason")
    private String deliveryHoldReason;

    @Column(name = "print_handed_over_by")
    private String PrintHandedOverBy;

    @Column(name = "delivery_held_by")
    private String deliveryHeldBy;

    @Column(name = "delivery_total_hold_seconds")
    private Long deliveryTotalHoldSeconds;

    @Column(name = "delivery_duration_seconds")
    private Long deliveryDurationSeconds;

    @Column(name = "delivered_by")
    private String deliveredBy;

    @Column(name = "delivery_vehicle_no")
    private String deliveryVehicleNo;

    // ── Delivery Cancel fields ────────────────────────────────────────
    @Column(name = "delivery_cancel_reason")
    private String deliveryCancelReason;

    @Column(name = "delivery_cancelled_by")
    private String deliveryCancelledBy;

    @Column(name = "delivery_cancel_time")
    private LocalDateTime deliveryCancelTime;

    // ── Confirm Portal fields ──────────────────────────────────────────
    @Column(name = "delivery_confirmed")
    private Boolean deliveryConfirmed;

    @Column(name = "delivery_confirmed_by")
    private String deliveryConfirmedBy;

    @Column(name = "delivery_confirm_time")
    private LocalDateTime deliveryConfirmTime;

    @Column(name = "cancel_confirmed")
    private Boolean cancelConfirmed;

    @Column(name = "cancel_confirmed_by")
    private String cancelConfirmedBy;

    @Column(name = "cancel_confirm_time")
    private LocalDateTime cancelConfirmTime;

    // ── Issue Confirm "Add to File" fields ─────────────────────────────
    @Column(name = "req_id")
    private String reqId;

    @Column(name = "file_number")
    private String fileNumber;
}
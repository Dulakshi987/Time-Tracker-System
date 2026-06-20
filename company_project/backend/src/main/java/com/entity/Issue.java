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
    private LocalDateTime holdTime;       // most recent hold start

    @Column(name = "resume_time")
    private LocalDateTime resumeTime;     // most recent resume

    @Column(name = "hold_reason")
    private String holdReason;            // most recent reason (kept for display)

    @Column(name = "held_by")
    private String heldBy;                // most recent held-by (kept for display)

    @Column(name = "total_hold_seconds")
    private Long totalHoldSeconds;        // cumulative hold time across all holds


    // ── Print Portal specific fields (prefixed with print_) ─────────────
    @Column(name = "print_status")
    private String printStatus;               // PENDING / IN_PROGRESS / ON_HOLD / COMPLETED
 
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
    private String printedBy;                 // who pressed "Print Done"
 
    @Column(name = "print_document_no")
    private String printDocumentNo;            // document number entered at print time

    // ── Check Portal fields (NEW) ─────────────────────────────────────
    @Column(name = "check_status")
    private String checkStatus;               // PENDING / IN_PROGRESS / ON_HOLD / COMPLETED
 
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
    private String checkedBy;                  // who pressed "Check Done"
 
    @Column(name = "has_wrong_material")
    private String hasWrongMaterial;            // "YES" / "NO"
 
    @Column(name = "wrong_material_sku")
    private String wrongMaterialSku;            // SKU or Description
 
    @Column(name = "wrong_material_qty")
    private String wrongMaterialQty;    
}

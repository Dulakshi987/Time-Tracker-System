// package com.entity;

// import jakarta.persistence.*;
// import lombok.*;

// import java.time.LocalDateTime;

// @Entity
// @Table(name = "document")
// @Data
// @NoArgsConstructor
// @AllArgsConstructor
// public class Document {

//     @Id
//     @GeneratedValue(strategy = GenerationType.IDENTITY)
//     private Long id;

//     private String jobType;
//     private String jobWBS;
//     private String reservationNo;
//     private String customerName;
//     private String enteredBy;
//     private String status;

//     private String requestDate;
//     private String requestTime;

//     @Column(name = "created_datetime")
//     private LocalDateTime createdDatetime;
// }



package com.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "document")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Document {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_type")
    private String jobType;

    @Column(name = "jobwbs")
    private String jobWBS;

    private String reservationNo;

    @Column(name = "customer_name")
    private String customerName;

    @Column(name = "entered_by")
    private String enteredBy;

    @Column(name = "status")
    private String status;

    @Column(name = "request_date")
    private String requestDate;

    @Column(name = "request_time")
    private String requestTime;

    @Column(name = "created_datetime")
    private LocalDateTime createdDatetime;

    
    // ── who requested this document (shown under Request Date/Time) ──
    @Column(name = "requested_by")
    private String requestedBy;

    // ── vehicle number for the request (shown under Requested By) ──
    @Column(name = "vehicle_no")
    private String vehicleNo;

    @Column(name = "division_no")
    private String divisionNo;

    // ── optional — new field ──
    @Column(name = "sap_issue_line_no")
    private String sapIssueLineNo;
}
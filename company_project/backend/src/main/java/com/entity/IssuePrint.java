package com.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Table(name = "issue_print")
@Data
public class IssuePrint {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long documentId;

    private String documentNo;
    private String customerName;
    private String jobwbs;
    private String reservationNo;

    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private Long durationSeconds;

    private String status;
    private String enteredBy;
}
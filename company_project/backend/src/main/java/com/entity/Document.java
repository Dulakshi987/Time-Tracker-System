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

    private String jobType;
    private String jobWBS;
    private String reservationNo;
    private String customerName;
    private String enteredBy;
    private String status;

    private String requestDate;
    private String requestTime;

    // @Column(name = "created_datetime")
    private LocalDateTime createdDatetime;
}
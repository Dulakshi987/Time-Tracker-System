package com.entity;

import jakarta.persistence.*;
import lombok.*;

// import java.time.LocalDate;
// import java.time.LocalTime;

@Entity
@Getter
@Setter
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
        private String requestDate;
        private String requestTime;
        private String status;

    // private String status;
}
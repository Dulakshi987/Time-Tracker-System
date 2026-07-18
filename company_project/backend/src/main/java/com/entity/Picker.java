package com.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import org.springframework.data.jpa.repository.JpaRepository;

@Entity
@Table(name = "picker")
@Data
public class Picker {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "picker_name")
    private String pickerName;

    @Column(name = "nic")
    private String nic;

    // Name exactly as it appears on the NIC — this is the value that shows
    // up in the "Picked By" dropdown across the Pick Portal.
    @Column(name = "picker_nic_name")
    private String pickerNicName;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}

interface PickerRepository extends JpaRepository<Picker, Long> {}
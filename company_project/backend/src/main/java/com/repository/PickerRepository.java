package com.repository;

import com.entity.Picker;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface PickerRepository extends JpaRepository<Picker, Long> {
}
package com.repository;

import com.entity.CheckOperator;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface CheckOperatorRepository extends JpaRepository<CheckOperator, Long> {
}
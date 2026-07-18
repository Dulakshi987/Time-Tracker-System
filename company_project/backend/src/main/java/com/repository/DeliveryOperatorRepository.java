package com.repository;

import com.entity.DeliveryOperator;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface DeliveryOperatorRepository extends JpaRepository<DeliveryOperator, Long> {
}
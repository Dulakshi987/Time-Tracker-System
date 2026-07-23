package com.repository;

import com.entity.PrintOperator;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface PrintOperatorRepository extends JpaRepository<PrintOperator, Long> {
     List<PrintOperator> findByDivisionNo(String divisionNo);
}
package com.repository;

import com.entity.Issue;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface IssueRepository extends JpaRepository<Issue, Long>, JpaSpecificationExecutor<Issue> {
    List<Issue> findByJobType(String jobType);
    List<Issue> findByStatus(String status);
    List<Issue> findByCustomerName(String customerName);
    List<Issue> findByPrintStatus(String printStatus);
    List<Issue> findByCheckStatus(String checkStatus);
    List<Issue> findByDeliveryStatus(String deliveryStatus);

    List<Issue> findByCheckStatusOrderByIdAsc(String checkStatus);
}